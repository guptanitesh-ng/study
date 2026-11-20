# Microservices Toolkit Notes

Reviewed: November 20, 2026. Source: personal notes from Microservices.pdf (study of *Building Microservices*), Resilience.pdf, Scalability.pdf, and Implementation.pdf.

**Context that shapes this file:** this is a reference toolkit, not a narrative — it's meant to get pulled open mid-interview during a system-design deep-dive, so headings are deliberately scannable and self-contained. Organized by **concern** (decomposition, communication, resilience, scalability, data, deployment, observability, testing), not by source PDF. For the "should we even use microservices" architecture-style decision, see [Architecture-Notes.md](Architecture-Notes.md); for the reusable design patterns referenced throughout (Strategy, Saga-adjacent patterns, idempotency), see [Design-Patterns-Principles-Notes.md](Design-Patterns-Principles-Notes.md); for caching strategy mechanics, see [Caching-Notes.md](../data/Caching-Notes.md).

Related: [Architecture-Notes.md](Architecture-Notes.md), [Design-Patterns-Principles-Notes.md](Design-Patterns-Principles-Notes.md), [Caching-Notes.md](../data/Caching-Notes.md), [Message-Middleware-Notes.md](../cloud/Message-Middleware-Notes.md).

## 1. Service Decomposition & Boundaries

**Monolith vs. Modular Monolith vs. Microservices:** a plain monolith is one codebase, one deployable, with no enforced internal boundaries. A **modular monolith** is still one deployable but with enforced module boundaries (see [Architecture-Notes.md § 4](Architecture-Notes.md#4-modular-monolith--the-deep-dive) for the full deep dive). **Microservices** go further: each bounded context is its own deployable, its own datastore, its own release cadence, communicating only over the network.

**Why not start with microservices (the YAGNI argument):** microservices come with a real, continuous cost often called the **"microservice tax"** — distributed tracing/observability tooling, network-call latency and failure modes replacing in-process calls, per-service CI/CD pipelines, service-discovery and API-gateway infrastructure, and data-consistency problems (no more free ACID transactions across what used to be one database). Paying that tax before you have the organizational scale or the scaling/isolation need to justify it is a net loss — you get all the distributed-systems complexity with none of the payoff.

**When to actually shift to microservices** — look for concrete, named pain rather than following trend:
- Independent teams are blocked on each other's deploy cadence inside one monolith.
- Specific modules have scaling or resource profiles (CPU/GPU/memory) wildly incompatible with the rest of the app.
- Compliance/isolation requirements demand a separate runtime/network boundary for part of the system.
- The monolith's build/test/deploy cycle has grown so large it's itself become the bottleneck.

**Microservices vs. SOA:**

| | SOA | Microservices |
|---|---|---|
| Integration | Centralized **Enterprise Service Bus** doing orchestration/transformation | Smart endpoints, dumb pipes — logic lives in services, not the transport |
| Service size | Larger, often shared across many consumers | Small, single bounded-context ownership |
| Data | Often shared databases across services | Each service owns its own datastore |
| Governance | Centralized, heavyweight | Decentralized, team-owned |

**Coupling types (name these to show you understand *why* service boundaries matter):**
- **Domain coupling** — unavoidable; two services are coupled because the business domain itself relates them (Order service must know an Order has a Customer).
- **Pass-through coupling** — a service passes data through to a downstream service without using it itself, just because the caller needs it there eventually — a smell that your boundaries are drawn wrong.
- **Common coupling** — multiple services share the same external dependency (shared DB table, shared library with mutable state) — a change to the shared thing can break every dependent.
- **Content coupling** — one service reaches directly into another's internal implementation/data store, bypassing its API entirely — the worst form, and the one "don't share tables" (§4 in Architecture notes) exists specifically to prevent.

**DDD basics worth having ready:**
- **Ubiquitous language** — the team and the code use the exact same vocabulary for domain concepts, eliminating translation drift between business and implementation.
- **Aggregate** — a cluster of domain objects treated as a single consistency boundary; all changes to objects inside an aggregate go through its root, and a transaction should never span more than one aggregate.
- **Bounded context** — the boundary within which a domain model and its ubiquitous language apply consistently; the same word ("Customer") can mean something different in the Billing bounded context vs. the Support bounded context, and that's fine as long as each context is self-consistent. **Bounded contexts are the primary heuristic for where to draw microservice boundaries.**

**Decomposition patterns:**
- **Strangler Fig** — incrementally route traffic for specific functionality from the old monolith to a new service, growing the new system "around" the old one until the monolith's corresponding code can be deleted — avoids a risky big-bang rewrite.
- **Feature Toggle** — ship new (possibly incomplete/risky) decomposed code paths dark, flip them on for a subset of traffic, and roll back instantly by flipping the toggle off if something's wrong, without a redeploy.

**Team ownership models:**
- **Strong ownership** — one team owns a service exclusively end-to-end (build, deploy, on-call); clearest accountability, but can bottleneck on that team for cross-cutting changes.
- **Collective ownership** — any team can modify any service; removes bottlenecks but risks inconsistent quality/style and unclear on-call accountability unless discipline (code review standards, shared CI gates) compensates.

**Interview follow-up:** *"Give me a real signal — not a buzzword — that tells you it's time to extract a module into its own service."* → The strongest signal is a **named, recurring deployment conflict**: e.g., team A can't ship because team B's unrelated change in the same monolith broke the build, repeatedly, for weeks — not "microservices are more scalable" in the abstract. The second-strongest signal is a genuine, measured resource-profile mismatch (one module needs 10x the instances of everything else). Anything weaker than a concrete recurring pain point is probably premature.

## 2. Inter-Service Communication

**Sync vs. async:**
- **Synchronous/blocking (request-response)** — caller waits for the response; simplest to reason about, but couples the caller's availability/latency to the callee's.
- **Asynchronous/non-blocking** — caller fires a request/event and continues; decouples availability, at the cost of needing to handle the response (if any) out-of-band, and needing idempotency (see [Design-Patterns-Principles-Notes.md § 9](Design-Patterns-Principles-Notes.md#9-event-ordering--idempotency-idempotent-receiver-pattern)) for at-least-once delivery semantics.

**API Gateway** — a single entry point in front of a set of services, handling cross-cutting concerns (auth, rate limiting, routing, request aggregation) so individual services don't each reimplement them.

| Pros | Cons |
|---|---|
| Single place to enforce auth/rate limiting/TLS termination | Can become a single point of failure if not made highly available itself |
| Can aggregate multiple backend calls into one client-facing response | Risk of becoming a "mini monolith" if business logic creeps in |
| Simplifies client-side service discovery (clients only know the gateway) | Adds one more network hop of latency to every call |

**Service Mesh** — a dedicated infrastructure layer (sidecar proxies, e.g., Envoy/Istio) handling service-to-service traffic concerns transparently to application code:
- **Service discovery** — services find each other without hardcoded addresses.
- **Load balancing** — client-side or sidecar-side balancing across instances.
- **Traffic management** — fine-grained routing (percentage-based canary rollout, A/B splits) without app code changes.
- **mTLS** — mutual TLS between services enforced at the mesh layer, not per-service.
- **Monitoring** — uniform metrics/tracing emitted by the sidecar for every service automatically.

**gRPC/REST protocol choice:** see [Architecture-Notes.md § 6](Architecture-Notes.md#6-grpc-vs-rest-a-style-selection-decision-not-just-a-syntax-choice) for the full comparison — kept there since it's a general style decision, not microservices-specific.

**UI composition patterns (how multiple backend services surface as one frontend):**
- **Monolithic Frontend** — one frontend app calls many backend microservices directly; simplest, but the frontend ends up needing to know about every backend service's shape.
- **Micro Frontends** — the frontend itself is decomposed to match backend service boundaries (each team ships its own UI fragment); matches Strong Ownership team models well, at the cost of frontend tooling/integration complexity.
- **Central Aggregating Gateway** — a backend layer aggregates multiple service calls into one response for the frontend, hiding backend topology from the client.
- **Backend-For-Frontend (BFF)** — like an aggregating gateway, but **one BFF per frontend type** (web BFF, mobile BFF) so each can shape the aggregation/response differently for that client's needs instead of one gateway trying to serve all clients identically.

**Library vs. Service vs. Sidecar (three ways to share cross-cutting functionality):**

| | Shared Library | Service | Sidecar |
|---|---|---|---|
| Deployment | Compiled into each consumer, versioned independently per consumer until upgraded | Its own deployable, called over the network | Deployed alongside each service instance, same host/pod |
| Update propagation | Requires every consumer to rebuild/redeploy to pick up a change | Instant for all callers once deployed | Requires redeploying sidecars (often automated via platform) |
| Language constraint | Must match consumer's language/runtime | Language-independent (network boundary) | Language-independent (process boundary) |
| Best for | Small, stable, rarely-changing logic (e.g., a validation helper) | Logic needing centralized state or its own scaling | Cross-cutting infra concerns (mesh proxy, log shipping) that shouldn't live in app code |

**Shared-library best practices:** version it semantically and let consumers upgrade on their own schedule (never force a breaking change on every service simultaneously); keep it genuinely cross-cutting and stateless — the moment a "shared library" starts encoding business logic specific to one domain, it's acting as hidden **common coupling** (§1) between services that should otherwise be independent.

**Reverse proxy note:** Nginx/HAProxy-style reverse proxies are the low-level building block an API Gateway or Service Mesh sidecar is often built on top of — worth naming if asked "how would you actually implement traffic routing," but the Gateway/Mesh patterns above are the higher-level answer for an architecture question.

**Interview follow-up:** *"Your mobile app and your web app both call the same ten backend services, but need the data shaped differently — gateway, or BFF?"* → BFF. A single aggregating gateway serving both forces it to either return a lowest-common-denominator shape (wasting mobile bandwidth/battery) or grow conditional logic per client type (turning the gateway into a shared bottleneck both frontend teams have to coordinate changes through). One BFF per frontend lets each frontend team own its own aggregation shape independently.

## 3. Resilience Patterns

**The three components of resilience (a framing device to lead with):**
- **Robustness** — the ability to resist failure in the first place (redundancy, input validation, capacity headroom).
- **Rebound** — the ability to recover quickly once failure happens (fast restarts, automated failover, retries).
- **Degrading functionality (graceful degradation)** — the ability to keep serving a *reduced* but still useful experience when a dependency fails, instead of failing the whole request (e.g., show cached recommendations if the personalization service is down, rather than failing the whole page).

**Stability patterns:**

| Pattern | Problem it solves | Gotcha |
|---|---|---|
| **Rate Limiting** (client-side vs. server-side) | Prevent one caller/client from overwhelming a service | Client-side limiting only works if clients are well-behaved/trusted; untrusted/external clients need server-side enforcement regardless |
| **CDN** | Absorb and cache static/cacheable traffic at the edge, away from origin services | Doesn't help with dynamic, per-user, or write traffic |
| **Timeouts** | Stop a caller waiting forever on an unresponsive dependency | Set too long, you've just delayed the failure; set too short, you create false failures under normal latency variance — tune against real p99 latency, not guesses |
| **Retries** | Smooth over transient failures (network blip, momentary overload) | Retries without **idempotency** on the callee, or without backoff/jitter, can amplify an outage into a retry storm |
| **Bulkheads** | Isolate resource pools (thread pools, connection pools) per dependency so one slow dependency can't starve resources needed by calls to other dependencies | Over-partitioning wastes capacity (unused headroom in one bulkhead while another is starved) — size pools against real traffic ratios |
| **Circuit Breakers** | Stop calling a dependency that's already failing, failing fast instead of piling up timeouts, and periodically test (half-open state) whether it's recovered | Wrong threshold tuning either trips too eagerly (treats normal blips as failures) or too late (lets a real outage pile up calls before tripping) |

**Isolation & redundancy:** isolate failure domains (separate instances/regions/AZs) so a failure in one blast radius doesn't propagate; add redundancy (multiple instances, multi-region) so a single failure doesn't remove capacity entirely — these two together are what actually makes Bulkheads and Circuit Breakers effective rather than just theoretical.

**Middleware / guaranteed delivery + idempotency:** reliable messaging middleware (brokers with at-least-once delivery, acks, DLQs) guarantees a message *will* be delivered (possibly more than once) — it's on the consumer to be **idempotent** (see [Design-Patterns-Principles-Notes.md § 9](Design-Patterns-Principles-Notes.md#9-event-ordering--idempotency-idempotent-receiver-pattern)) so "delivered more than once" doesn't corrupt state. These two concerns — guaranteed delivery and idempotency — are always a pair; implementing one without the other leaves a gap.

**Spreading risk:** deliberately distribute load/traffic/data across independent units (shards, cells, regions) so that a failure or a bad deploy affects only a fraction of total traffic/users rather than everyone at once — this is the reasoning behind canary deploys, cell-based architecture, and sharding all at once.

**CAP theorem, in the resilience framing:** the same CAP trade-off (see [Architecture-Notes.md § 2](Architecture-Notes.md#2-cap-theorem)) shows up here as a resilience decision: when a dependency is unreachable, do you fail the request (favor consistency) or serve a degraded/cached/stale response (favor availability)? Graceful degradation *is* choosing availability over consistency at the application level.

**Chaos Engineering:** deliberately inject failure into production (or production-like) systems to validate resilience assumptions *before* a real outage tests them for you — Netflix's suite is the standard reference:
- **Chaos Monkey** — randomly terminates individual instances.
- **Chaos Gorilla** — takes down an entire availability zone.
- **Latency Monkey** — injects artificial latency/errors into service calls, specifically to validate timeout/circuit-breaker tuning rather than hard failures.

**Interview follow-up:** *"You added a circuit breaker in front of a flaky downstream service — three weeks later, on-call says it's tripping constantly even though the downstream team says their service is healthy. What do you check?"* → First, check the breaker's threshold/window configuration against *current* real traffic and latency — thresholds tuned against old traffic patterns are the single most common cause of "healthy service, tripping breaker." Second, check whether retries from upstream callers (with the breaker closed) are themselves creating enough load to make the downstream service look unhealthy to the breaker — a retry storm can make a healthy service self-DOS from the breaker's point of view. Third, confirm the health-check/half-open probe used to decide "has it recovered" actually reflects real traffic shape (a lightweight health-check endpoint can report healthy while the real request path is still struggling).

## 4. Scalability Patterns

**The four axes of scaling (a framing device worth leading with — most scaling questions map to one of these four):**
1. **Vertical scaling** — bigger instance (more CPU/RAM). Simplest, but has a ceiling and doesn't improve fault tolerance (still one instance).
2. **Horizontal duplication** — run more identical copies behind a load balancer (the "competing consumer" pattern for queue-based workloads — multiple consumers competing for messages off the same queue). Improves both scale and fault tolerance, but only works for stateless or state-externalized workloads.
3. **Data partitioning (sharding)** — split data across multiple stores/instances by some key, so each shard handles a fraction of total load. The caveat the notes flag explicitly: **queries that need to span shards** (cross-shard joins/aggregations) become expensive or require a separate aggregation layer — sharding is a trade that helps single-shard-key queries a lot and multi-shard queries a lot less (or not at all).
4. **Functional decomposition** — split by *capability* rather than by duplicating/partitioning the same thing — this is, at root, the same move as microservice decomposition (§1), viewed through a scaling lens.

**Code optimization** — the cheapest axis that isn't really an "axis": profile and fix hot paths before reaching for infrastructure scaling; it's easy to over-invest in horizontal scaling to compensate for an N+1 query or an unindexed lookup that a 20-minute fix would solve directly.

**Load balancing:** distribute requests across instances (round-robin, least-connections, latency-aware) — the thing that makes horizontal duplication actually work; see the Distributed Systems vs. Sticky Sessions note in [Architecture-Notes.md § 7](Architecture-Notes.md#7-a-couple-of-smaller-architecture-decision-notes) for why sticky sessions undermine this.

**Monitoring:** scaling decisions (manual or auto-) are only as good as the metrics driving them — see § 7 below for the observability/tracing toolkit that feeds this.

**Autoscaling:** automatically add/remove instances based on monitored load (CPU, queue depth, request rate) — the automation layer on top of horizontal duplication; the main gotcha is scaling *reactively* on a metric that lags real demand (e.g., CPU climbing only after a queue is already backed up) — leading indicators (queue depth) often make better autoscaling triggers than lagging ones (CPU).

**Caching — condensed, microservices-specific angle only** (full cache-strategy mechanics — cache-aside, read-through, write-through, write-behind, write-around, eviction policies — are covered in depth in [Caching-Notes.md](../data/Caching-Notes.md); not re-explained here):
- **Where to place the cache relative to service boundaries** is itself a design decision: a cache *inside* one service's boundary (private cache) avoids coupling other services to its invalidation logic; a *shared* distributed cache (e.g., one Redis cluster used by several services) is cheaper to run but reintroduces the "shared dependency" common-coupling risk (§1) if two services cache overlapping data without a shared invalidation contract.
- **Conditional GETs / ETags** pair naturally with a distributed cache at the HTTP layer — a client/gateway can avoid re-fetching a payload that hasn't changed, cutting both latency and cross-service load, without needing application-level cache logic in every consumer.
- **Event-based invalidation across distributed caches** — when the source of truth changes, publish an invalidation event (rather than relying purely on TTL expiry) so every service's local cache (or cache region) can evict the stale entry promptly; Redis Keyspace Notifications are one concrete mechanism for this.
- **Distributed Cache vs. Database latency, roughly:** an in-memory distributed cache hit is typically sub-millisecond to low-single-digit milliseconds; a database round trip (even a fast indexed query) is usually several milliseconds to tens of milliseconds once network + query execution + connection-pool wait are accounted for — the order-of-magnitude gap is the entire reason caching exists as a scalability lever, not just a latency nicety.

**Interview follow-up:** *"Your service is read-heavy and you've added a distributed cache in front of the DB — load testing still shows the DB as the bottleneck. What do you check?"* → Cache hit ratio first — a cache with a low hit ratio (wrong key design, TTL too short relative to access pattern, or a very long tail of unique keys) still forces most traffic to the DB regardless of the cache's existence. Second, check for **cache stampede** on expiry (many requests missing simultaneously for a hot key right after it expires, all hitting the DB at once) — mitigated with request coalescing or staggered/jittered TTLs. Only after ruling those out would sharding the DB (axis 3 above) be the next lever.

## 5. Data & Consistency Across Services

**The core problem:** once each service owns its own datastore (§1), a business operation that used to be one ACID transaction across tables now spans multiple services/databases with no shared transaction — you need a pattern to keep them consistent without a distributed transaction (2PC), which doesn't scale/fail gracefully in practice.

**Saga pattern:** a sequence of local transactions, one per service, where each step publishes an event/triggers the next step, and if any step fails, previously completed steps are undone via **compensating transactions** (not a DB rollback — a deliberate, explicit "undo" business operation, e.g., "refund payment" to compensate for "charge payment").

| | Orchestrated Saga | Choreographed Saga |
|---|---|---|
| Coordination | A central orchestrator explicitly calls each service in sequence and handles failure/compensation logic itself | No central coordinator — each service reacts to the previous service's event and publishes its own, next service reacts to that |
| Visibility | Easy to see the whole flow in one place (the orchestrator) | Flow is implicit, spread across event handlers — harder to trace end-to-end without good tooling |
| Coupling | Orchestrator is coupled to every participating service's interface | Services are only coupled to event *contracts*, not to each other directly — lower coupling, but changing the flow means touching several services' handlers instead of one orchestrator |
| Best fit | Complex flows with many conditional branches/compensations | Simpler, more linear flows, or when you want to avoid a central coordinator becoming a bottleneck/God Object |

**Recovery direction:**
- **Backward recovery** — undo completed steps via compensating transactions when a later step fails (the typical Saga failure path).
- **Forward recovery** — instead of undoing, retry the failed step forward until it succeeds (only viable when the step is guaranteed to eventually succeed, e.g., a transient infrastructure blip rather than a genuine business rejection).

**Correlation ID:** a single ID generated at the start of a saga/flow and threaded through every message/event in it, so logs/traces across every participating service can be joined back into one end-to-end view — without this, debugging a failed saga across five services is close to impossible (see § 7 Observability for the broader distributed-tracing version of this idea).

**Which to prefer:** choreographed sagas scale better organizationally (no shared orchestrator every team has to coordinate changes through) but need strong event-contract discipline and good tracing to stay debuggable; orchestrated sagas are easier to reason about and debug for complex flows but make the orchestrator a central dependency (and a God Object risk if business logic creeps into it rather than staying coordination-only). Default to choreography for simple 2-3 step flows; default to orchestration once you have several conditional branches or compensation paths.

**Handling out-of-order events:**
- **Delayed queue pattern** — if an event arrives referencing a prerequisite that hasn't been processed yet (e.g., an "OrderShipped" event arriving before "OrderPlaced" has been fully processed), park it on a delay queue and retry after a backoff instead of failing it outright or processing it against incomplete state.
- **Watermarking** (stream processing) — track a "watermark" timestamp representing "we believe all events up to this point in time have arrived"; events arriving after the watermark has passed their expected time are treated as late and handled by an explicit late-data path (reprocess, or route to a dead-letter/reconciliation flow) rather than silently corrupting an already-finalized aggregation window.

**Interview follow-up:** *"Why not just use a distributed transaction (two-phase commit) across services instead of all this Saga complexity?"* → 2PC requires every participant to hold locks until every other participant has voted to commit — across network calls to independently-owned, independently-scaled services, that means your transaction's latency and availability are now bounded by the *slowest or least available* participant, and a coordinator crash mid-protocol can leave participants blocked holding locks indefinitely. Saga trades transactional atomicity for availability and service autonomy — each local transaction commits immediately, and failure is handled by business-level compensation instead of a locking protocol, which is exactly the Architecture-level AP-vs-CP choice (see [Architecture-Notes.md § 2](Architecture-Notes.md#2-cap-theorem)) made concrete at the data layer.

## 6. Deployment & Operational Concerns

**Artifact/repo patterns:**
- **Monorepo** — all services in one repository; easier cross-service refactors and atomic multi-service commits, but needs strong tooling (selective build/test, code ownership rules) to avoid becoming a bottleneck as it grows.
- **Multirepo** — one repository per service; clean ownership boundaries matching service boundaries, but cross-service changes require coordinating multiple PRs/merges and there's no atomic commit across them.

**Deployment principles:**
- **Isolated execution** — each service deploys and runs independently of others' deploy cycles/failures.
- **Automation** — deploys are scripted/pipeline-driven, not manual, to make them repeatable and low-risk.
- **Infrastructure as Code (IaC)** — environment/infra definitions are version-controlled artifacts, not manual console clicks, so environments are reproducible and auditable.

**Zero-downtime deployment patterns:**

| Pattern | How it works | Best for |
|---|---|---|
| **Rolling deployment** | Replace instances a few at a time, old and new versions serve traffic simultaneously during rollout | Default choice for most stateless services |
| **Blue-Green** | Run a full second ("green") environment, switch all traffic over at once, keep "blue" as instant rollback | When you want an instant, all-or-nothing cutover and rollback, at the cost of running 2x infra briefly |
| **Canary** | Route a small % of real traffic to the new version, expand gradually while watching metrics | When you want to catch a bad deploy against a small blast radius before it reaches everyone |
| **Feature Toggle** | Deploy new code dark, activate via a runtime flag, independent of the deploy itself | Decoupling *deploy* from *release* — lets you deploy during business hours and release later, or release gradually by cohort |
| **Parallel run** | Run old and new implementations side-by-side against the same input, compare outputs, without the new one's output actually being used yet | Validating a risky rewrite's correctness before trusting it with real traffic |
| **Synthetic transactions** | Continuously run fake/canary transactions through the live system post-deploy to catch regressions before real users do | Post-deploy verification, especially for critical paths (checkout, payment) |

**Desired state management:** declare the *desired* infrastructure/deployment state (e.g., "3 replicas of v2.1") and let a control loop (Kubernetes being the standard example) continuously reconcile actual state toward it, rather than issuing imperative one-off commands — this is what makes self-healing (restarting crashed instances automatically) and rolling deployments reliable without manual babysitting.

**Deployment options spectrum** (increasing abstraction, decreasing operational control):
Physical servers → Virtual Machines → Containers → Application Containers (e.g., a managed container platform) → Platform-as-a-Service (PaaS) → Function-as-a-Service (FaaS). Moving right trades operational control/customization for less infrastructure to manage yourself — FaaS is the extreme end (no server/runtime management at all, but cold-start latency and execution-time limits to design around).

**Cloud Native characteristics** (the checklist a service should satisfy to be considered genuinely cloud-native, not just "runs in a container"):
- **Externalized configuration** — config lives outside the artifact (env vars, config server), so the same build artifact is promoted unchanged across environments.
- **RESTful/stateless** — no server-side session affinity required (ties back to the Sticky Sessions note in Architecture § 7).
- **Fault tolerant** — survives individual instance failure without manual intervention.
- **Discoverable** — registers itself for service discovery rather than requiring hardcoded addresses.
- **Secure** — secrets externalized/managed, not baked into images.
- **Monitorable** — exposes health/metrics endpoints.
- **Traceable** — participates in distributed tracing (propagates trace context — see § 7).

**Runtime/framework comparison (Implementation.pdf's cloud-native-runtime angle):**
- **Jakarta EE / MicroProfile** — standards-based enterprise Java, historically heavier startup/footprint than newer cloud-native-first frameworks.
- **Quarkus** (and GraalVM native images generally) — built cloud-native-first: dramatically faster startup time and lower memory footprint than a traditional JVM app, at the cost of longer build times (native image compilation) and some reflection-heavy libraries needing extra configuration to work under native compilation. The trade-off matters specifically for FaaS/high-scale-to-zero deployments, where cold-start time directly costs money/latency; it matters far less for always-on, long-lived services where JVM warm-up is a one-time cost.
- **Spring Cloud vs. Kubernetes** — a lot of what Spring Cloud historically provided (service discovery via Eureka, client-side load balancing via Ribbon, config server) is now provided natively by Kubernetes (its own service discovery/DNS, kube-proxy load balancing, ConfigMaps/Secrets) — meaning on K8s you often don't need the Spring Cloud equivalents at all. Where Spring still earns its keep on K8s: **Actuator health/readiness endpoints feeding Kubernetes liveness/readiness probes directly** — that integration is additive, not competing.

**Kubernetes Jobs/CronJobs vs. Spring Batch/Spring Cloud Task — when to use which:**

| | K8s Jobs/CronJobs | Spring Batch / Spring Cloud Task |
|---|---|---|
| Best for | Simple, stateless, infrastructure-level scheduled work (cleanup scripts, simple scheduled calls) | Complex batch processing with chunked reads/writes, retry/skip logic per record, restart-from-checkpoint semantics |
| State/restart | No built-in notion of "resume from where it failed" within a job run | Built-in job-repository-backed restart/checkpoint support |
| Where logic lives | Logic is just "run this container to completion" — K8s doesn't know what's inside | Framework understands the batch domain (steps, chunks, readers/writers/processors) |

**Config storage note:** see [Architecture-Notes.md § 7](Architecture-Notes.md#7-a-couple-of-smaller-architecture-decision-notes) — the typed-columns-vs-JSON-blob trade-off applies the same way whether or not you're in a microservices context, so it's kept there rather than duplicated here.

**Interview follow-up:** *"You're moving a Spring Boot app to Kubernetes — which Spring Cloud components would you actually keep?"* → Drop Eureka/service-registry and Ribbon/client-side load balancing — Kubernetes's own DNS-based service discovery and kube-proxy give you that natively, and running two service-discovery mechanisms side by side is just redundant complexity. Keep Spring Boot Actuator, specifically its `/health/liveness` and `/health/readiness` endpoints wired to K8s liveness/readiness probes — that's genuinely complementary, not duplicated functionality.

## 7. Observability & Distributed Tracing

**Why this needs its own heading:** in a monolith, "where did this request go wrong" is a stack trace. Across a dozen microservices, it's not — you need deliberate tooling to reconstruct one logical request's path across process/network boundaries.

**Core components of distributed tracing:**
- **Trace ID** — one ID generated at the very start of a request, propagated to every downstream service call, tying the entire distributed request together.
- **Span** — one unit of work within a trace (e.g., one service's handling of the request, or one DB call inside that) — has a start time, duration, and its own ID.
- **Parent-child relationships** — spans nest (a service's span is the parent of the spans for the downstream calls it makes), letting tracing tools reconstruct the full call tree, not just a flat list of events.
- **Context propagation** — the trace ID (and parent span ID) must be carried across every network hop, usually via HTTP headers — if any service in the chain drops/fails to forward these headers, the trace breaks into disconnected fragments at that point.
- **Trace storage & visualization** — traces are shipped to a backend (Jaeger, Zipkin, or a vendor APM) that stores and renders them as timeline/waterfall views, so you can see exactly which span in which service ate the latency.

**Auto-instrumentation (how you get tracing without manually adding code to every call site):**
- **Bytecode manipulation** — the tracing agent rewrites method bytecode at class-load time to inject span start/stop calls around known framework entry/exit points (HTTP handlers, DB drivers) — works without touching source code, but is tied to specific framework versions it knows how to instrument.
- **Monkey patching** — at the language-runtime level (more common in dynamic languages), replace a library's functions at runtime with wrapped versions that add tracing before delegating to the original.
- **eBPF** — instruments at the kernel/syscall level, capturing network calls without any application-level code changes or language-specific agents at all — the most invasive-free option, increasingly used for infrastructure-wide tracing/observability without per-service instrumentation effort.

**Sampling strategies** (you can't trace 100% of traffic forever at scale — this is the trade-off table):

| Strategy | How it decides | Trade-off |
|---|---|---|
| **Head-based sampling** | Decision made at the start of the trace (e.g., "trace 1% of requests") before knowing the outcome | Cheap, simple, but may miss tracing the exact rare error you cared about |
| **Tail-based sampling** | Decision made *after* the full trace completes (e.g., "keep it if it was slow or errored") | Catches the interesting cases reliably, but requires buffering/holding every trace until it completes before deciding — more infra cost |
| **Rate limiting sampling** | Cap traces per second regardless of volume | Protects the tracing backend from being overwhelmed during a traffic spike, at the cost of under-sampling exactly when you'd want more visibility (during an incident) |

**Log aggregation, correlation IDs, and time skew:**
- **Log aggregation** — ship every service's logs to a central store (ELK, a hosted log platform) so you can search across all services for one request instead of SSH-ing into N boxes.
- **Correlation ID in logs** — thread the same trace/correlation ID used for tracing (§ above, and the Saga correlation ID in § 5) through structured log lines too, so logs and traces can be cross-referenced for the same request.
- **Time skew** — if service hosts' clocks aren't tightly synchronized (NTP drift), log timestamps across services can appear out of order even when the actual event sequence was correct — don't trust raw cross-service timestamp ordering for causality; trust the trace's parent-child span structure instead, which doesn't depend on wall-clock agreement between hosts.

**Interview follow-up:** *"A trace shows a 2-second gap between Service A calling Service B and Service B's span starting — what are your hypotheses?"* → Network/queueing latency between the two (load balancer queueing, TCP connection setup, TLS handshake) is the first suspect; second, check whether context propagation headers were dropped and this is actually a *different*, unrelated trace that happens to show adjacent timestamps rather than a real causal gap — cross-check the trace/span IDs, not just visual proximity in a timeline; third, given the time-skew caveat above, confirm both hosts' clocks are actually synchronized before trusting the 2-second figure as physically real latency rather than clock drift.

## 8. Testing Microservices

**Consumer-driven contracts:** instead of (or in addition to) full end-to-end integration tests across services, each **consumer** of a service defines a contract (expected request/response shape) that the **provider** service runs against its own code in CI — this catches breaking changes to a shared API at the provider's build time, without needing a live, deployed, cross-team environment to run the test against.

**Avoid cross-team end-to-end tests as your main safety net:** full E2E tests spanning many independently-deployed services are slow, flaky (any one service being briefly unhealthy fails the whole suite), and create a shared-ownership/blame problem when they fail (whose service caused it?). Consumer-driven contracts plus strong per-service test suites, with a *small* number of true E2E smoke tests for the most critical paths, scales much better organizationally than relying on E2E coverage as the primary safety net.

**MTBF vs. MTTR — the trade-off framing for "how reliable is reliable enough":**
- **MTBF (Mean Time Between Failures)** — how often things break.
- **MTTR (Mean Time To Recovery)** — how fast you recover once something breaks.

The practical point: in a microservices system, driving MTBF to near-zero (preventing all failures) is both expensive and asymptotically impossible at scale — a system with dozens of independently-deployed services *will* have individual component failures regularly. The more cost-effective investment is usually **optimizing MTTR** — good observability (§ 7), fast rollback mechanisms (§ 6), circuit breakers/graceful degradation (§ 3) that contain blast radius — because recovering from failure fast is a more tractable, scalable target than preventing failure entirely.

**Interview follow-up:** *"Your team wants to invest more in reliability — would you push for more pre-production testing, or more production observability/rollback tooling?"* → Frame it as the MTBF-vs-MTTR trade-off directly: more pre-production testing (contract tests, better staging environments) improves MTBF but has diminishing returns against the kinds of failures microservices actually see in practice (network partitions, one dependency's resource exhaustion under real production load patterns that staging rarely reproduces). Investment in MTTR — tracing, fast canary rollback, circuit breakers — tends to pay off faster and more predictably, because it helps regardless of *which* failure mode shows up, including the ones you didn't think to test for.
