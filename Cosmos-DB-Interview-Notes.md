# Azure Cosmos DB: Interview Notes

Added: November 19, 2026. Source: general Cosmos DB working knowledge (no source PDF for this one) — written to close a specific resume gap: Cosmos DB is listed as a named skill, but day-to-day exposure is likely via an SDK/repository abstraction (similar to the Elasticsearch and Redis gaps already documented), not hands-on partition/throughput design. This file is scoped to the decisions an interviewer actually probes: partition-key design, RU economics, consistency-level trade-offs, and where Cosmos differs from the relational/Elasticsearch mental models you already have deep notes on.

Related: [Elasticsearch](Elasticsearch-Interview-Notes.md) (both are JSON-document stores, but solve different problems), [Caching/Redis](Caching-Interview-Notes.md#1-in-process-vs-distributed-cache) (distributed-store failure-mode thinking transfers directly), [SQL](SQL-Interview-Notes.md) (contrast against the relational model you already know well).

## 1. The mental model shift: it's not "NoSQL MySQL"

Coming from Oracle/MySQL/SQL Server, the trap is treating Cosmos as "a schema-less table." The actual unit of everything — cost, scalability, and query performance — is the **partition key**, chosen at container-creation time and effectively immutable afterward (you can't repartition in place; a bad choice means a migration to a new container).

| Relational concept | Cosmos equivalent | Key difference |
|---|---|---|
| Database | Database | Just a billing/namespace boundary; RUs are usually provisioned at container or database level |
| Table | Container | Schema-free — different documents in the same container can have different shapes |
| Row | Item (JSON document) | No foreign keys; relationships are either embedded or denormalized, not joined |
| Primary key | `id` + partition key | `id` is unique *only within a logical partition*, not container-wide |
| Index on every column | Indexed by default on every property | You *opt out* (exclude paths) rather than opt in — the inverse of relational habit |

**Why this matters in an interview:** if asked "how would you model an order-processing system in Cosmos," the wrong answer is "same tables, just JSON." The right answer leads with the partition key (`customerId`? `tenantId`? `orderId`?) and justifies it against the dominant access pattern — because that choice determines whether a query is a cheap, single-partition read or an expensive, RU-burning cross-partition fan-out.

## 2. Partition key — the single most important design decision

A **logical partition** is all items sharing the same partition-key value; Cosmos transparently maps logical partitions onto **physical partitions** (storage/throughput units) and splits them automatically as data grows.

**What makes a good partition key:**
- **High cardinality** — many distinct values, so writes/storage spread evenly (a single partition caps out at 20 GB and a slice of the container's total RU/s).
- **Even access distribution** — avoid a "hot partition" where one value (e.g., a single large tenant, or `status = "PENDING"`) absorbs disproportionate traffic; Cosmos throttles (429) per-physical-partition, not just per-container, so a hot key starves *itself* even if the container overall has spare RU/s.
- **Matches the dominant query filter** — a query that includes the partition key in its `WHERE`/predicate is a single-partition query (cheap, low latency); a query without it is a **fan-out/cross-partition query** that touches every physical partition and is billed and latency-charged accordingly.

**Common real patterns:**
- `tenantId` for a multi-tenant SaaS app — assumes tenants are reasonably balanced in size; a single mega-tenant becomes a hot partition.
- `customerId` or `userId` for a user-scoped data model — most reads are "give me this user's data," which lands on one partition.
- A **synthetic/composite key** (`tenantId_date` or `deviceId_hour`) when the natural key is too low-cardinality or too hot alone — trades some query complexity for better write distribution.

**The interview follow-up to expect:** "you picked `orderId` as the partition key — what happens when you need 'all orders for a customer'?" Correct answer: that's now a cross-partition query (expensive) unless you denormalize a customer-scoped read model, add a secondary index pattern via a second container, or reconsider the key. There's rarely a single partition key that makes *every* access pattern cheap — the job is picking the one that matches the hottest/most latency-sensitive pattern and accepting the trade-off for the rest.

## 3. Request Units (RU) — the metered-cost mental model

Every operation (read, write, query) consumes a measured number of **Request Units**, Cosmos's abstracted CPU/memory/IO cost unit. A 1 KB point read of a single item is ~1 RU; writes cost more than reads (data is written, indexed, and — if enabled — replicated synchronously to the write region); larger/more complex queries (unfiltered scans, many `ORDER BY`/aggregation operations, cross-partition fan-out) cost proportionally more.

| Lever | Effect |
|---|---|
| **Point read by id + partition key** | Cheapest possible operation — the baseline to design toward |
| **Query with partition key in filter** | Single-partition query — still cheap |
| **Query without partition key** | Cross-partition fan-out — RU cost scales with physical partition count |
| **Indexing policy (all properties indexed by default)** | Every indexed property adds write-side RU cost; excluding rarely-queried/large paths (e.g., big nested blobs) lowers write RU |
| **Consistency level** | Session (default)/Eventual are cheaper than Strong/Bounded Staleness, which pay extra for stronger guarantees |
| **Provisioning mode** | Manual (fixed RU/s, pay for reserved capacity, risk of 429 throttling under spikes) vs. Autoscale (scales RU/s within a band, costs more per-RU but absorbs spikes) vs. Serverless (pay per request, good for spiky/low-baseline workloads, not for sustained high throughput) |

**429 (Too Many Requests)** means a specific partition exceeded its RU/s share for that moment — not that the whole container is overwhelmed. The SDK's default retry policy handles transient 429s with backoff automatically; a well-behaved client still needs **bulk operations using the SDK's bulk executor** or **exponential backoff with jitter** for write-heavy bursts (e.g., bulk-loading migrated data), because naive single-threaded sequential writes under autoscale will hit the ceiling and the app sees cumulative latency from retries, not an outage.

## 4. Consistency levels — pick based on the actual read-after-write requirement

Cosmos offers five consistency levels, a spectrum between "fast and loose" and "linearizable and expensive":

| Level | Guarantee | Cost/latency | Typical use |
|---|---|---|---|
| **Strong** | Linearizable — reads always see the latest committed write | Highest latency, requires synchronous cross-region replication, lowest availability during a region outage | Rare — financial ledger balance reads where staleness is unacceptable |
| **Bounded Staleness** | Reads lag writes by at most K versions or T time | Lower than Strong, still ordered | Near-real-time dashboards needing a bounded staleness SLA |
| **Session (default)** | Within *the same client session*, read-your-own-writes is guaranteed; other clients may see stale data briefly | Good balance — most apps default here | The vast majority of application code — a user immediately sees their own update |
| **Consistent Prefix** | Reads never see out-of-order writes (no gaps), but may be stale | Cheaper than Bounded Staleness | Event/activity feeds where order matters more than freshness |
| **Eventual** | No ordering guarantee at all, eventually converges | Cheapest, lowest latency, highest availability | Non-critical denormalized read models, "likes" counters |

**The trap:** defaulting to Strong "to be safe" without being asked — it's the most expensive and lowest-availability option, and most business requirements ("the user sees their own change") are actually satisfied by Session, which is the SDK default. Knowing *why* Session is the default, and when you'd deliberately override it (per-request override is supported), is the real signal.

## 5. Change feed — Cosmos's event-sourcing hook

The **change feed** is a persistent, ordered (per logical partition) log of inserts and updates to a container (deletes require a separate "soft delete" convention — a flag plus TTL, since the change feed does not natively surface hard deletes). It's the mechanism behind:

- **Materialized/denormalized read models** — project the primary write-model container into a second container shaped for a different access pattern (solving the "wrong partition key for this query" problem from Section 2 without re-architecting the source).
- **Event-driven integration** — trigger downstream processing (notifications, search-index sync, audit trail) without polling or dual-writing from application code.
- **Azure Functions Cosmos DB trigger** is the most common consumption pattern — a function fires per batch of changes per partition, with checkpointing (lease container) tracking progress so a restart resumes rather than reprocesses from the start.

This is conceptually the same "events as integration, not direct coupling" idea from your [messaging notes](Message-Middleware-Interview-Notes.md) — change feed is Cosmos acting as both the system of record *and* the event source, instead of needing an outbox pattern to a separate broker.

## 6. Cosmos vs. Elasticsearch vs. relational — when each actually fits

Given you now have notes on all three, the interview question "when would you use Cosmos vs. Elasticsearch vs. SQL here" has a crisp answer:

| Need | Fit |
|---|---|
| ACID transactions across multiple entities, strong relational integrity | Relational (SQL) |
| Full-text search, relevance scoring, faceted/aggregated search across large text corpora | Elasticsearch |
| High-throughput, globally-distributed, low-latency **operational** reads/writes keyed by a known access pattern (point reads, not search) | Cosmos DB |
| Flexible/evolving document shape, but still mostly point-lookup or partition-scoped query, not relevance ranking | Cosmos DB |

**Why this matters for your profile specifically:** your Elasticsearch gap notes already establish "I've used it behind an abstraction, not operated it directly" as a credible, explainable answer. Cosmos deserves the same honest framing — if your hands-on work was through a repository/SDK wrapper, say so, then pivot immediately to the partition-key and consistency-level reasoning above, which is the part interviewers actually use to gauge whether you understand *why* Cosmos behaves the way it does, not whether you've hand-tuned RU/s in production.

## 7. SDK and application-integration notes (Spring/Java angle)

- The **Azure Cosmos DB Java SDK** (and `azure-spring-data-cosmos` for Spring Data-style repositories) mirrors the Spring Data pattern you already know from JPA: `@Container`, `@PartitionKey`-annotated fields, and `CosmosRepository`-style interfaces — the same "repository abstraction over a store-specific client" shape as `JpaRepository`/`RedisRepository`.
- Connection mode: **Direct** (TCP, lower latency, more connections) vs. **Gateway** (HTTPS, works through firewalls/proxies, slightly higher latency) — Gateway is the safer default in constrained network environments (e.g., strict outbound firewall rules in an enterprise/healthcare network), Direct is preferred for latency-sensitive services that can open the required ports.
- Idempotency still matters: a retried write (from a 429/timeout retry) should be safe to apply twice — Cosmos doesn't give you transactional dedup across retries by default, so the same optimistic-concurrency (`ETag`/`If-Match`) and idempotency-key patterns from your reliability/messaging background apply here too, not just to queue consumers.
