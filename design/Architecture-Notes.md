# Architecture Notes

Reviewed: November 20, 2026. Source: personal notes from Design Nuggets.pdf and Design, Architecture.pdf — CAP/PACELC theorems, architecture styles (layered, modular monolith, microservices, component-based, event-driven), consistency/replication trade-offs, and the non-functional-requirements checklist used to drive architecture reviews.

**Context that shapes this file:** this is the HLD decision layer — the questions you answer *before* picking which micro-level patterns from [Design-Patterns-Principles-Notes.md](Design-Patterns-Principles-Notes.md) to apply inside any one service. The goal in an interview is rarely "name the theorem" — it's "given this scenario, which trade-off do you accept, and why." Each section below is built around a trade-off table or a scenario, not a definition.

Related: [Design-Patterns-Principles-Notes.md](Design-Patterns-Principles-Notes.md) (micro-level patterns once you've picked a style), [Microservices-Toolkit-Notes.md](Microservices-Toolkit-Notes.md) (deep-dive once microservices is the chosen style), [Caching-Notes.md](../data/Caching-Notes.md) (caching strategy detail), [Message-Middleware-Notes.md](../cloud/Message-Middleware-Notes.md) (broker mechanics).

> **For microservices-specific deep-dive patterns (resilience, scalability, decomposition, implementation concerns), see [Microservices-Toolkit-Notes.md](Microservices-Toolkit-Notes.md) — this file deliberately does not duplicate that content.**

## 1. Architecture styles at a glance

| Style | Consistency | Scalability | Ops cost | Failure isolation | Team-structure fit |
|---|---|---|---|---|---|
| **Layered (classic N-tier)** | Strong — single DB, single transaction boundary | Vertical mostly; horizontal only by scaling whole app | Low — one deployable, one pipeline | Poor — one bug/outage can take the whole app down | Good for a single small-to-medium team |
| **Modular Monolith** | Strong — still one DB/process by default, enforced module boundaries in code | Vertical, or horizontal by duplicating the whole app behind a load balancer | Low — still one deployable | Moderate — a module can misbehave (e.g., leak threads) and affect the whole process, but code-level coupling is controlled | Multiple teams if boundaries are respected; needs discipline without physical enforcement |
| **Microservices** | Eventual by default; strong consistency only within one service's own transaction | Excellent — scale each service independently | High — N pipelines, N runtimes, distributed tracing/observability tax | Excellent — one service's crash doesn't take down others (with proper resilience patterns) | Best fit for many autonomous teams, each owning a service end-to-end |
| **Component-Based** | Depends on component granularity — usually in-process, so strong | Same deployable unit, scaled together, unless components are split into separate processes | Low-to-moderate | Moderate — good internal separation, same physical blast radius as layered unless deployed separately | Good middle ground — teams can own components with clear contracts without full service-ownership overhead |
| **Event-Driven** | Eventual — consumers react asynchronously to published events | Excellent — producers and consumers scale independently, buffered by the broker | Moderate-to-high — needs a reliable broker, dead-letter handling, event schema governance | Excellent — a slow/down consumer doesn't block the producer (if the broker buffers correctly) | Good fit once you have multiple teams producing/consuming each other's events, needs strong event-contract discipline |

**The interview trap:** don't present this table as "microservices is strictly better." The honest framing: start with a **Modular Monolith** by default (cheapest to operate, easiest to refactor internally, still lets multiple teams work in parallel if module boundaries are enforced), and only move to microservices when you have a concrete, named pain point the monolith can't solve (see [Microservices-Toolkit-Notes.md § Service Decomposition & Boundaries](Microservices-Toolkit-Notes.md#1-service-decomposition--boundaries) for the full "why not start with microservices" argument).

## 2. CAP theorem

**Definition:** in the presence of a network **P**artition, a distributed system must choose between **C**onsistency (every read sees the latest write) and **A**vailability (every request gets a response, even if it's not the latest data). You only have to make this choice *during* a partition — CAP says nothing about normal operation.

| System | Typical choice during partition | Why |
|---|---|---|
| MongoDB (single primary, majority writes) | **CP** | Writes require primary + majority ack; if partitioned from majority, it refuses writes rather than risk serving stale/conflicting data |
| Cassandra (tunable, default quorum) | **AP** | Designed to keep serving reads/writes using whatever replicas are reachable, resolving conflicts later (last-write-wins or custom resolvers) |
| PostgreSQL (single node) | **CA in theory** | A single node can't actually be partitioned from itself — CAP only applies once you introduce replicas/distribution; single-node Postgres isn't really a CAP-relevant system at all |

**Scenario-driven picks, worth having ready:**
- **E-commerce shopping cart** → favor **AP**. Losing a moment of strict consistency (a stale cart view) is a far smaller user-facing cost than refusing to let someone add to their cart during a partition.
- **E-commerce order placement / payment capture** → favor **CP**. Double-charging or confirming an order that can't actually be fulfilled is worse than a brief unavailability window.
- **Social media feed** → favor **AP**. A slightly stale feed is invisible to the user; refusing to load the feed at all is not.
- **Social media profile/account settings (email, password)** → favor **CP**. Serving a stale password hash or email address right after a user changed it is a security problem.
- **"Points balance" / loyalty-rewards microservice** → genuinely dual-natured: the **write path** (redeeming/accruing points) should be **CP** — you cannot let two partitioned replicas both allow spending the same points. The **read path** (displaying current balance on a dashboard) can be **AP** — a few-second-stale balance display is an acceptable trade for availability. This is the example to use when an interviewer pushes on "can one system be both?" — yes, per *operation*, not globally.

**Interview follow-up:** *"If CP and AP are only decided 'during a partition,' what does a system do the other 99% of the time?"* → Most of the time there's no partition, so the system is both consistent and available — CAP is a forced choice only in the degraded case. The real engineering work is deciding, operation by operation, which side of that forced choice you want *before* the partition happens, and building the replication/quorum config to match (see PACELC below for what you additionally trade off with zero partitions).

## 3. PACELC theorem

**Definition:** extends CAP — **if Partitioned**, choose **A**vailability or **C**onsistency (same as CAP); **Else** (normal operation, no partition), choose **L**atency or **C**onsistency. PACELC is the more complete framing because most of a system's life is spent in the "Else" branch, where CAP has nothing to say but there's still a real trade-off between waiting for replicas to confirm (consistency, higher latency) vs. responding immediately (lower latency, possible staleness).

**Replication scenarios (how the "Else" trade-off actually gets implemented):**
- **Preprocessing/synchronous replication** — the write isn't acknowledged to the client until all (or a quorum of) replicas confirm it. Strong consistency, higher write latency. This is PC in PACELC terms.
- **Async-I (fire-and-forget async)** — primary acknowledges immediately, replicates in the background. Lowest latency, but a crash before replication means data loss and replicas can briefly serve stale reads. This is PL.
- **Async-II (async with read-your-writes guarantee)** — same background replication, but the *writer's own* subsequent reads are routed back to the primary (or a replica guaranteed to be caught up) so the writer never sees their own write "disappear," even though other readers might still see stale data briefly.
- **Hybrid-III** — synchronous replication to a *subset* of replicas (e.g., one same-region replica) for a latency/consistency middle ground, async to the rest (e.g., cross-region DR replicas).

**The quorum formula to have ready:** for a system with **N** replicas, **W** replicas required to acknowledge a write, and **R** replicas read from, you get **strong consistency** if **R + W > N** (read and write quorums are guaranteed to overlap by at least one replica, so a read is guaranteed to see the latest write). If **R + W ≤ N**, you've chosen **eventual consistency** in exchange for lower per-operation latency (smaller quorums needed) — this is the dial most tunable systems (Cassandra, DynamoDB-style quorum config) expose directly to you.

**Interview follow-up:** *"Your system is CP under CAP — does that mean it's automatically consistency-favoring under PACELC too?"* → Not automatically — they're independent axes. You could build a system that's CP during a partition (refuses writes without majority) but still favors latency over consistency during normal operation (e.g., serves reads from the nearest replica without confirming it's caught up). PACELC is the framework that catches designs which are "correct" under CAP but still have a latency/consistency gap nobody noticed because it only shows up outside partition scenarios.

## 4. Modular Monolith — the deep dive

A modular monolith is a single deployable process, internally split into modules with **enforced** boundaries (compiler-level package visibility, architecture-fitness tests, or module-system constraints) — not just a folder convention everyone agrees to respect.

**Non-negotiable rules the notes call out:**
- **Bounded contexts per module**, mirroring how you'd eventually split services if you ever did move to microservices — this is what keeps the "if we need to split this later" option realistically open.
- **One-way dependency flow** — module A can depend on module B, but not vice versa; cyclic module dependencies are exactly the kind of coupling a modular monolith exists to prevent.
- **Sync calls between modules in-process** (direct method calls) for request/response needs; **async (in-process event bus/pub-sub)** for anything that shouldn't block the caller or that multiple modules may want to react to.
- **"Don't share tables"** — each module owns its own tables; another module reaches your data through your module's API/service layer, never a direct cross-module SQL join. This is the rule most teams break first, and breaking it is what makes a later split to microservices nearly impossible without a painful untangling project.
- **Prefer ACID-per-command over Saga/Outbox** — because everything is one process with one database, you get to keep real multi-table transactions for a single business command, instead of needing the Saga pattern's compensating-transaction machinery (see [Microservices-Toolkit-Notes.md § Data & Consistency Across Services](Microservices-Toolkit-Notes.md#5-data--consistency-across-services) for what you give up when you can no longer do this). This is one of the single biggest complexity savings a modular monolith buys you over microservices.

**When it's a good fit (four scenarios worth naming):**
1. A small-to-medium team that doesn't yet have the organizational scale to own independent services end-to-end.
2. A domain where most business transactions genuinely need multi-entity ACID guarantees (e.g., "move money" needs both the debit and credit to commit atomically).
3. Early-stage product where the module boundaries themselves are still being discovered/refactored — splitting into real services too early means redrawing network-level boundaries as you learn the domain, which is far more expensive than redrawing in-process module boundaries.
4. You want the *option* to split into microservices later without having pre-paid the full distributed-systems tax before you know you need it.

**When it's a poor fit (three scenarios worth naming):**
1. Different modules have wildly different, independent scaling needs (one module is CPU-bound and needs 50 instances, another is barely used) — scaling the whole monolith to satisfy one hot module wastes resources on the rest.
2. Teams need genuinely independent deploy cadences and the organization can't enforce module discipline well enough to avoid one team's bug/outage taking down the whole process.
3. You have hard compliance/isolation requirements that require a separate runtime/network boundary per domain (e.g., PCI scope isolation) — no amount of in-process module discipline satisfies an auditor who requires physical separation.

**Interview follow-up:** *"Your team has a modular monolith and one module is suddenly getting 10x the load of the rest — what do you do before reaching for a full microservices split?"* → First check whether it's genuinely a *scaling* problem or a *code* problem — vertical scaling or just scaling out more copies of the whole monolith behind a load balancer is often enough and is far cheaper than a service extraction. Only if the hot module's resource profile is fundamentally incompatible with the rest (e.g., it needs GPU instances, or its load pattern would force over-provisioning everything else) does extracting that one module into its own service become the right call — and because the modular monolith already enforced "don't share tables" and one-way dependencies, that one extraction is comparatively cheap.

## 5. Event-driven architecture & messaging primitives

**Event-Driven Architecture (EDA):** components communicate by publishing and reacting to **events** (facts that something happened), rather than one component directly calling another. Producers don't know or care who (if anyone) consumes an event.

| Term | What it actually is |
|---|---|
| **Message** | A generic unit of data sent from one party to another — the broad category |
| **Event** | A message representing a *fact that already happened* ("OrderPlaced") — immutable, no response expected, may have zero or many consumers |
| **Command** | A message representing a *request to do something* ("PlaceOrder") — expects exactly one handler, often expects a response/ack |
| **Queue** | Point-to-point delivery — one message, consumed by exactly one consumer (even with multiple consumers competing, only one gets each message) |
| **Topic/Event Bus** | Publish-subscribe delivery — one message, delivered to every subscriber independently |
| **Message Broker** | The infrastructure component (RabbitMQ, Kafka, SQS) that physically routes messages between producers and consumers, providing durability/ordering/retry |

For broker-specific mechanics (exchanges, delivery guarantees, dead-letter queues), see [Message-Middleware-Notes.md](../cloud/Message-Middleware-Notes.md) — not duplicated here.

**Interview follow-up:** *"Why model something as an event instead of a command, if a direct synchronous call would be simpler to reason about?"* → Because an event decouples the producer from needing to know who cares, or how many parties care, or whether they care *yet* (a consumer added six months later can subscribe to historical event types without the producer changing at all). The cost is you give up the simplicity of "I called it, I know it happened" — you now need idempotent consumers, you need to reason about delivery ordering/duplication (see [Design-Patterns-Principles-Notes.md § 9](Design-Patterns-Principles-Notes.md#9-event-ordering--idempotency-idempotent-receiver-pattern)), and debugging "why didn't X happen" means tracing through a broker instead of a call stack.

## 6. gRPC vs. REST (a style-selection decision, not just a syntax choice)

| | REST (JSON over HTTP) | gRPC (protobuf over HTTP/2) |
|---|---|---|
| Payload | Text (JSON) — human-readable, larger | Binary (protobuf) — smaller, faster to (de)serialize |
| Contract | Usually implicit/loosely enforced (OpenAPI is optional tooling) | Strongly typed `.proto` contract, enforced at codegen time |
| Streaming | Awkward (long polling, SSE, or a second protocol like WebSockets) | Native bidirectional streaming over HTTP/2 |
| Browser-friendliness | Native | Needs a proxy (gRPC-Web) for browser clients |
| Best fit | Public/partner-facing APIs, human-debuggable traffic, broad client compatibility | Internal service-to-service calls where you control both ends and want performance + strict contracts |

**Interview follow-up:** *"You're designing internal service-to-service calls for a new microservice — would you default to gRPC?"* → Lean yes for performance-sensitive, high-fan-out internal calls where you control both client and server codegen — but weigh it against your team's tooling maturity (debugging binary protobuf traffic is harder without good tooling) and whether you need easy human-readable traffic inspection during incident response; a lot of teams standardize on REST internally anyway purely for operational uniformity/debuggability, accepting the performance cost.

## 7. A couple of smaller architecture-decision notes

**Config storage — columns vs. a JSON blob column:** store configuration as **typed columns** when the shape is stable and you need to query/index/validate individual fields at the DB level; store it as a **JSON blob** when the shape is genuinely dynamic/per-tenant/evolving faster than you want to run migrations for. The trap: teams default to a JSON blob "for flexibility" even when the shape is actually stable, and lose query-ability, indexing, and schema validation for no real benefit.

**Distributed systems vs. sticky sessions:** sticky sessions (routing a client to the same backend instance for the life of a session) are a crutch that works against a distributed system's core strength (any node can serve any request). Favor **externalizing session state** (e.g., Redis-backed sessions) over sticky sessions wherever possible — sticky sessions reintroduce a single point of failure per user and complicate rolling deployments/autoscaling (see the Cloud Native/12-Factor discussion in [Microservices-Toolkit-Notes.md § Deployment & Operational Concerns](Microservices-Toolkit-Notes.md#6-deployment--operational-concerns)).

## 8. Appendix — how to approach an architecture interview / review

A non-functional-requirements (NFR) checklist worth walking through out loud when asked to "design X," since it signals you're not just solving the happy-path functional problem:

| NFR category | What to check |
|---|---|
| **Performance** | Latency/throughput targets, caching strategy, expected load and its growth curve |
| **Usability** | API ergonomics for consumers, error-message clarity, documentation |
| **Interoperability / portability** | Can this run on another cloud/another DB vendor without a rewrite? Are you locked into vendor-specific APIs unnecessarily? |
| **Compliance** | Data residency, PII handling, audit-trail requirements, retention policy |
| **Code quality tooling** | Static analysis, linting, test coverage gates — the NFRs that keep the *next* six months of changes safe, not just the initial build |

A matching **code review checklist** mindset: beyond "does it work," check for NFR regressions (did this change quietly remove a cache, add an N+1 query, or widen a compliance-sensitive data exposure), and check that the change respects whatever architecture style boundaries are in force (module boundaries in a modular monolith, service boundaries in microservices).

**Interview follow-up:** *"You're five minutes into a system-design interview and the interviewer hasn't mentioned any non-functional requirements — what do you do?"* → Ask. Specifically ask about expected scale/growth, consistency requirements per operation (not just globally), and any compliance constraints — these three answers alone usually determine which row of the §1 architecture-styles table and which CAP/PACELC trade-off you should be designing toward, and guessing wrong here invalidates everything built on top of it.
