# System Design Notes

Reviewed: November 20, 2026. Source: synthesized in original wording from general system-design-interview practice (not transcribed from any single book) — this file intentionally does not reproduce text from commercial sources studied alongside it, to respect copyright; it captures the repeatable interview *framework* plus a handful of worked problems built from first principles using the trade-offs already covered elsewhere in this repo.

**Context that shapes this file:** this is Layer 3 — the thing you actually do for 45 minutes in a system-design interview. It assumes you already have the vocabulary from [Architecture-Notes.md](Architecture-Notes.md) (CAP/PACELC, architecture styles) and [Microservices-Toolkit-Notes.md](Microservices-Toolkit-Notes.md) (decomposition, resilience, scalability patterns) — this file is the **process** that tells you when to reach for which of those, not a restatement of them. Don't re-derive CAP theorem here; cite it and move on.

Related: [Architecture-Notes.md](Architecture-Notes.md), [Microservices-Toolkit-Notes.md](Microservices-Toolkit-Notes.md), [Caching-Notes.md](../data/Caching-Notes.md), [Elasticsearch-Notes.md](../data/Elasticsearch-Notes.md), [Cosmos-DB-Notes.md](../data/Cosmos-DB-Notes.md), [System-Design-Index.md](System-Design-Index.md) (cross-file lookup table).

## 1. The repeatable framework

A system-design interview is graded on **process**, not on landing at "the one right answer" — there usually isn't one. Run the same five steps every time, out loud, so the interviewer can follow (and redirect) your reasoning:

1. **Clarify requirements (3-5 min).** Pin down functional scope (what must the system do — explicitly list what's *out* of scope too) and non-functional priorities (read-heavy or write-heavy? latency SLA? consistency requirement? expected scale?). Never skip this — assuming the wrong priority (e.g. optimizing for consistency when the interviewer wanted availability) wastes the rest of the interview.
2. **Back-of-envelope capacity estimate (3-5 min).** Rough numbers for DAU/QPS, read:write ratio, storage growth per year, bandwidth. The precision doesn't matter — the exercise does: it tells you whether you're building for "fits on one Postgres box" or "needs sharding and a CDN from day one," which changes every later decision.
3. **Define the API/interface (2-3 min).** A handful of endpoints or RPCs with request/response shapes. Forces you to nail down exactly what the system exposes before you design its internals.
4. **High-level design (10-15 min).** Draw boxes: client → load balancer/API gateway → services → datastores/caches/queues. Narrate data flow for the 1-2 most important use cases end to end. Keep it high-level first — resist diving into one box before the overall shape is agreed.
5. **Deep dive (15-20 min).** The interviewer will steer you into 1-2 specific hard parts (a hot partition, a race condition, a consistency edge case, a failure mode). This is where you actually earn the signal — cite specific patterns from Architecture/Microservices-Toolkit notes rather than hand-waving.

Throughout: **state trade-offs explicitly, never present a single option as if it were free.** "I'd use eventual consistency here because X, accepting Y risk, which I'd mitigate with Z" reads far stronger than silently picking a database and moving on.

## 2. Requirements-gathering: the questions that matter

| Dimension | Questions to ask | Why it changes the design |
|---|---|---|
| **Read/write ratio** | Is this closer to Twitter (read-heavy, >100:1) or a payments ledger (write-heavy, strict ordering)? | Drives caching strategy, whether you denormalize, whether CQRS is worth the complexity (see [Design-Patterns-Principles-Notes.md § CQRS](Design-Patterns-Principles-Notes.md)). |
| **Consistency requirement** | Can a user see stale data for a few seconds, or must every read reflect the latest write (e.g. inventory, account balance)? | Picks your spot on the CAP/PACELC spectrum (see [Architecture-Notes.md](Architecture-Notes.md)) and whether you need synchronous replication somewhere. |
| **Latency SLA** | p99 budget — tens of ms (autocomplete) vs. seconds (batch report)? | Determines whether a cache/CDN is mandatory vs. optional, and whether synchronous cross-service calls are even viable. |
| **Scale** | DAU, peak QPS, data volume/growth rate | Decides single-box vs. sharded, SQL vs. a horizontally-scaled NoSQL store. |
| **Availability expectation** | Is a few minutes of downtime during a regional failure acceptable, or does it need active-active multi-region? | Drives replication topology and failover design — and the ops cost that comes with it. |
| **Durability** | Can data loss ever be tolerated (e.g. best-effort analytics events) or never (financial transactions)? | Decides sync vs. async write acknowledgement, and whether you need a write-ahead log / outbox pattern. |

**Interview follow-up:** *"The interviewer says 'design Twitter' and nothing else — what do you do?"* → Don't start drawing. Explicitly narrow scope out loud: "I'll focus on the post-and-timeline-read flow; I'll skip DMs, ads, and search unless you want me to come back to them." Naming what's out of scope is itself a signal of experience.

## 3. Back-of-envelope estimation cheat sheet

Numbers worth having memorized (approximate, that's the point):

- 1 day ≈ 86,400 s ≈ **~100k seconds** (round for quick math).
- QPS estimate: `DAU × actions/user/day ÷ 86,400`, then multiply by **2-3x for peak-to-average ratio** — average load is not what takes your system down.
- Storage: estimate per-record size × records/day × retention period; always sanity-check against "does this fit in RAM for caching, on one disk, or do I need to shard."
- Common latency intuition: in-memory/cache read ~1 ms, same-datacenter network round trip ~0.5-1 ms, SSD random read ~0.1 ms, cross-region network round trip ~100-150 ms. The cross-region number is the one that should scare you into caching/replicating data closer to users.
- Rule of thumb: a well-tuned single modern DB instance comfortably handles low-thousands of QPS for simple reads; beyond that you're talking read replicas, caching, or sharding — not "just add a bigger box" indefinitely.

**Interview follow-up:** *"Why bother with these numbers if they're all rough guesses anyway?"* → Because the rough number still answers a binary design question precisely enough: "do I need a CDN," "do I need to shard," "is a single Postgres with a read replica enough." Precision doesn't matter; which side of the threshold you land on does.

## 4. High-level building blocks (the toolbox you assemble from)

Rather than re-deriving each from scratch per problem, know these building blocks and when each is reached for — the deep mechanics live in their dedicated files:

- **Load balancer** — distributes traffic across stateless service instances (round-robin, least-connections, consistent-hashing for session affinity); first thing between client and services in almost every design.
- **API Gateway** — see [Microservices-Toolkit-Notes.md § Inter-Service Communication](Microservices-Toolkit-Notes.md) for the full pros/cons table.
- **Cache (CDN / in-memory / distributed)** — see [Caching-Notes.md](../data/Caching-Notes.md) for cache-aside vs. write-through vs. write-behind, eviction policies, thundering-herd mitigation.
- **Message queue / event bus** — decouples producers from consumers, smooths load spikes, enables async workflows; see [Message-Middleware-Notes.md](../cloud/Message-Middleware-Notes.md) for broker-specific trade-offs (Kafka vs. RabbitMQ, ordering, at-least-once delivery) and [Microservices-Toolkit-Notes.md](Microservices-Toolkit-Notes.md) for event ordering/idempotency patterns.
- **Search index** — see [Elasticsearch-Notes.md](../data/Elasticsearch-Notes.md) when a problem needs free-text search, faceting, or relevance ranking that a relational `WHERE LIKE` can't deliver at scale.
- **Document/wide-column/NoSQL store** — see [Cosmos-DB-Notes.md](../data/Cosmos-DB-Notes.md) for partition-key design, consistency-level tuning, and when it beats a relational store.
- **Relational store** — default choice when strong consistency and relational integrity matter more than horizontal write scale; see [SQL-Notes.md](../data/SQL-Notes.md).
- **Rate limiter** — protects downstream services from abuse/overload; typically token-bucket or sliding-window-counter, usually implemented at the gateway.
- **Object/blob storage** — for large binary payloads (images, videos, exports) that don't belong in a row-oriented DB; usually paired with a CDN for read-heavy delivery.

## 5. Worked problem walkthroughs

Each walkthrough is intentionally terse — it's meant to demonstrate *the shape of a strong answer*, not to be read as a finished design doc. Practice narrating each one out loud in under 10 minutes before an interview.

### 5.1 Design a URL shortener

- **Requirements:** given a long URL, return a short one; given the short one, redirect to the original. Read-heavy (redirects vastly outnumber creations). Mild consistency requirement — a short code briefly unavailable right after creation is tolerable; a code resolving to the *wrong* URL is not.
- **Capacity:** assume high write:read skew the other way — e.g. 100M new URLs/month, 100:1 read:write ratio on redirects. Storage per record is small (a few hundred bytes); even billions of records are a few hundred GB, well within a sharded key-value store.
- **API:** `POST /urls {longUrl} -> {shortCode}`, `GET /{shortCode} -> 302 redirect`.
- **High-level design:** service generates a short code (base-62 encoding of an auto-incrementing/distributed-unique ID, or a hash with collision retry), stores `{shortCode -> longUrl}` in a key-value store, fronts reads with a cache (hot URLs are heavily skewed — classic cache-aside candidate).
- **Deep dive the interviewer will likely steer into:** how to generate unique codes without a single-point-of-failure counter (pre-allocated ID ranges per server, or a distributed ID generator like Snowflake) — this is the signal-bearing part, not the redirect logic.

### 5.2 Design a rate limiter

- **Requirements:** cap how many requests a client (by API key/user/IP) can make per time window; must be low-latency (it sits in the hot path of every request) and correct even under concurrent requests from the same client.
- **Algorithms (know the trade-off, not just the name):** fixed window counter (simple, but allows 2x burst at window boundaries); sliding window log (accurate, but memory-heavy — one timestamp per request); sliding window counter (good approximation, bounded memory — usually the right default); token bucket (naturally allows controlled bursts, a common choice for API gateways).
- **Where state lives:** a distributed cache (e.g. Redis) shared across all gateway instances, since the limiter must be consistent across horizontally-scaled nodes — a per-instance in-memory counter under-counts and lets through far more traffic than intended once you scale out.
- **Deep dive the interviewer will likely steer into:** race conditions on concurrent increments (atomic INCR + TTL, or a Lua script for check-and-increment as one atomic operation) and what happens when the rate-limiter store itself is unavailable (fail-open vs. fail-closed is a real product decision, not a technicality).

### 5.3 Design a chat/messaging system

- **Requirements:** 1:1 and group messaging, delivery and read receipts, online/offline handling, message history. Needs low latency for "online" delivery but must also durably persist for offline users.
- **High-level design:** clients hold a long-lived connection (WebSocket, or long-polling as a fallback) to a stateful connection-management service; a separate message-persistence service writes to a durable store; a message queue decouples "message received" from "fan out to all recipients' connections," which matters a lot for group chats.
- **Deep dive the interviewer will likely steer into:** how you route a message to the right connection-server when a user's WebSocket is held by one specific server instance out of many (a connection-registry/presence service mapping userId → serverId, often backed by the same cache tier used elsewhere), and how you guarantee message ordering within a conversation when multiple servers might handle different participants.
- **Connection failure:** a network can disappear without a clean close. Use heartbeats and bounded idle timeouts to detect stale connections; remove presence with expiry or connection ownership checks so an old disconnect cannot remove a newer connection. Clients reconnect with exponential backoff and jitter, reauthenticate, and resume from a durable cursor or fetch missed messages. A reconnect alone does not guarantee delivery or order: deduplicate by message ID and define ordering and replay/retention behavior.

### 5.4 Design a news feed / social timeline

- **Requirements:** users post content; followers see a reverse-chronological (or ranked) feed of posts from people they follow. Extremely read-heavy, and the central design tension is **fan-out-on-write vs. fan-out-on-read**.
- **Fan-out-on-write (push):** when a user posts, immediately push the post into every follower's precomputed feed (e.g. a list in a cache/store per user). Feed reads become a single cheap lookup — but a celebrity with millions of followers makes a single post trigger millions of writes ("the celebrity problem").
- **Fan-out-on-read (pull):** feed is computed at read time by merging the latest posts from everyone a user follows. Writes stay cheap and constant-cost, but every feed read now does real work — fine for a user following 50 people, expensive for one following 5,000.
- **Pragmatic answer (the one that actually impresses):** hybrid — fan-out-on-write for most users, fall back to fan-out-on-read merged in for accounts above a follower-count threshold. Naming this hybrid unprompted is usually the strongest single thing you can say in this problem.
- **Deep dive the interviewer will likely steer into:** ranking (relevance vs. pure recency) and how you'd cap/paginate the precomputed feed cache so it doesn't grow unbounded per user.

## 6. Interviewer follow-ups worth rehearsing

- *"How do you decide whether to shard, cache, or replicate when a store is overloaded?"* → Diagnose the actual bottleneck first: cache if it's read-heavy with a skewed hot set; add read replicas if it's read-heavy but *not* skewed (uniform access); shard if it's write-heavy or the data volume itself no longer fits one node regardless of read pattern. Picking the mechanism before diagnosing the bottleneck is the most common weak answer here.
- *"What's the single thing you'd change about your design if told to assume 10x the scale?"* → A strong answer names a concrete bottleneck that breaks first (e.g. "the single Postgres primary would become the write bottleneck; I'd introduce sharding by userId") rather than a vague "add more servers."
- *"Where's the single point of failure in what you just drew?"* → Always have an honest answer ready — every design has at least one, and naming it proactively (and how you'd mitigate it, e.g. leader election, multi-AZ replicas) reads far better than being caught by the question.
