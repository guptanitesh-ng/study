# Design Patterns & Principles Notes

Reviewed: November 20, 2026. Source: personal notes from Design Nuggets.pdf and Design, Architecture.pdf — SOLID, the GoF catalog (mostly recognized through Java standard-library internals and old-school EJB container plumbing), documentation frameworks (C4, 4+1 view model), CQRS, and Event Sourcing.

**Context that shapes this file:** the original notes read like a pattern-spotting exercise against real APIs rather than textbook UML — Factory is `Calendar.getInstance()`, Singleton is `Runtime`/`DriverManager`, Proxy is RMI stubs. That's a stronger interview answer than reciting GoF definitions, so it's kept front and center below. This file is scoped to **reusable micro-level patterns/principles** — things you apply inside a service or a class. For whole-system architecture decisions (which style to pick, CAP/PACELC trade-offs), see [Architecture-Notes.md](Architecture-Notes.md). For anything microservices-specific (decomposition, resilience, scaling), see [Microservices-Toolkit-Notes.md](Microservices-Toolkit-Notes.md).

Related: [Architecture-Notes.md](Architecture-Notes.md), [Microservices-Toolkit-Notes.md](Microservices-Toolkit-Notes.md), [Java-Core-Notes.md](../java/Java-Core-Notes.md).

**How to read each entry:** problem it solves → when you'd actually reach for it → the trade-off/gotcha that trips people up → a follow-up question an interviewer is likely to ask next.

## 1. SOLID principles

| Principle | One-liner | Reach for it when | Trade-off / gotcha |
|---|---|---|---|
| **SRP** — Single Responsibility | A class/module should have one reason to change | You notice a class changing for unrelated reasons (e.g., a business-rule change *and* a persistence-format change both touch the same class) | Taken too far, you get an anemic explosion of tiny classes that are individually simple but collectively hard to navigate |
| **OCP** — Open/Closed | Open for extension, closed for modification | You keep adding `if/else`/`switch` branches every time a new variant shows up | Achieving this (via Template Method/Decorator/Strategy) adds indirection — don't apply it pre-emptively to code that only has one variant today |
| **LSP** — Liskov Substitution | A subtype must be usable anywhere its base type is expected, without surprising the caller | You're about to model an "is-a" relationship via inheritance | The classic trap below — inheritance based on real-world taxonomy, not behavioral substitutability, breaks LSP silently |
| **ISP** — Interface Segregation | Don't force a client to depend on methods it doesn't use | A fat interface makes most implementers throw `UnsupportedOperationException` on half the methods | Over-segregating creates interface sprawl that's annoying to wire together with DI |
| **DIP** — Dependency Inversion | High-level modules depend on abstractions, not concrete low-level modules | You want to swap an implementation (DB vendor, transport protocol) without touching business logic | The abstraction still has to be *designed well* — a leaky interface that mirrors one implementation's quirks defeats the point |

**SRP, the EJB Façade example:** a classic anti-pattern is a single Session Façade EJB that owns validation, orchestration, *and* persistence mapping for an entire module. Changing a validation rule, a workflow step, or a DB column mapping all mean touching the same class — three reasons to change living in one place.

**OCP, the enablers:** Template Method and Decorator are the two patterns that most directly let you extend behavior without editing existing code — Template Method by letting subclasses override specific steps of an algorithm, Decorator by wrapping an object rather than modifying its class.

**LSP, the canonical break — Square extends Rectangle:** mathematically a square *is* a rectangle, so the inheritance looks right. But `Rectangle.setWidth()`/`setHeight()` are independent in the base type's contract; `Square` has to override both setters to keep width == height, which silently breaks any caller that assumed setting width alone wouldn't touch height. The lesson: model inheritance on **behavioral contracts**, not real-world "is-a" taxonomy.

**ISP, the servlet example:** `HttpServletRequestAware`-style interfaces exist precisely so a component only has to implement the one callback it needs instead of a monolithic lifecycle interface with a dozen methods it would otherwise have to stub out.

**DIP, the SOAP→REST example:** if business logic calls a `PaymentGateway` interface rather than a concrete SOAP client, swapping the backing transport to REST later is a new adapter class, not a rewrite of call sites.

**Interview follow-up:** *"Give me a concrete example where strictly following LSP forced you to change a class hierarchy."* → Lead with Square/Rectangle, but better: describe a real case — a `ReadOnlyAccount` that extends `Account` and throws on `withdraw()` violates LSP because callers that only know about `Account` can legitimately call `withdraw()`. The fix is usually to separate the capability (`Withdrawable`) from the identity (`Account`) rather than forcing a type hierarchy to carry a behavioral restriction.

## 2. The rest of the "10 design principles" (beyond SOLID)

Interviewers sometimes ask for "10 design principles" expecting SOLID (5) plus five more. The common companion set:

| Principle | One-liner | Reach for it when | Trade-off / gotcha |
|---|---|---|---|
| **DRY** — Don't Repeat Yourself | Every piece of knowledge should have one authoritative representation | You find the same business rule/constant duplicated across files | Over-applying DRY to code that merely *looks* similar (not *conceptually* the same) creates premature, brittle coupling — see "DRY vs. accidental duplication" below |
| **KISS** — Keep It Simple | Prefer the simplest design that solves the actual problem | You're tempted to add a framework/abstraction layer "just in case" | The most commonly forgotten principle when people recall this list from memory — it's the sibling of YAGNI but about design complexity, not scope |
| **YAGNI** — You Aren't Gonna Need It | Don't build speculative flexibility for requirements that don't exist yet | You're about to add a config flag/extension point with no current caller | Taken too far, it conflicts with OCP — the balance is building for *known* variation (OCP), not *imagined* variation (YAGNI) |
| **Law of Demeter** — Principle of Least Knowledge | An object should only talk to its "immediate friends" (fields, params, things it creates) — not reach through them to their internals | You see chained calls like `a.getB().getC().getD()` | Strictly enforcing it can force an explosion of pass-through wrapper methods; apply it pragmatically to genuine encapsulation boundaries, not to every getter chain |
| **Low Coupling / High Cohesion** | Modules should depend on as little of each other as possible, while each module's own responsibilities stay tightly related | You're deciding how to draw a class/module boundary | These two pull in tension with DIP/ISP — coupling is unavoidable at integration points; the goal is depending on *stable abstractions*, not eliminating coupling entirely |

**DRY vs. accidental duplication:** two pieces of code can look identical today but represent *different* business rules that happen to coincide — e.g., tax calculation and discount calculation both currently compute `amount * 0.1`. Deduplicating them into one shared function couples two concepts that should be free to evolve independently; the first time one rate changes and the other doesn't, the "DRY" abstraction has to be unwound. The rule of thumb: DRY applies to one piece of *knowledge*, not to code that merely has the same shape.

**Composition over Inheritance** is also frequently listed alongside these (see Inheritance vs. composition vs. delegation below) — it's really a corollary of LSP/Low-Coupling rather than an independent principle, which is why counts of "10 principles" vary by source.

**Interview follow-up:** *"Give an example where YAGNI and OCP seem to conflict, and how you'd resolve it."* → A `PaymentProcessor` interface (OCP, so adding a new payment method doesn't require editing existing code) vs. speculatively building a plugin-loader/config-driven rule engine for payment methods nobody has asked for yet (YAGNI violation). Resolve by designing the *seam* (interface) now, since you already know variation is coming, but deferring the *infrastructure* (dynamic loading, config schema) until a second real implementation actually shows up.

## 3. Documentation frameworks (how you *describe* the design, not the design itself)

**C4 model** — four zoom levels for describing a system, used top-down:
1. **Context** — the system as one box, plus the users/external systems it talks to.
2. **Container** — the deployable units inside it (web app, API, DB, message broker) and how they talk to each other.
3. **Component** — the major structural building blocks inside one container (controllers, services, repositories).
4. **Code** — class diagrams — C4 explicitly says most teams shouldn't bother maintaining this level by hand; let IDEs generate it on demand.

**4+1 view model** — five views of one architecture, used when a single diagram can't communicate concerns to different audiences:
- **Logical view** — the functional decomposition (what Component view in C4 roughly covers).
- **Process view** — concurrency, runtime processes, threads.
- **Development view** — module/package organization from a developer's/build's point of view.
- **Physical view** — deployment topology (maps to C4 Container, with infra detail).
- **Scenarios (+1)** — concrete use cases that validate the other four views are consistent with each other; this is the view that catches "looks right on paper but doesn't actually support the real workflow."

**When to choose which:** C4 is faster to produce and far easier to keep current for most teams — it's the default for day-to-day architecture communication. Reach for 4+1 when you specifically need to show **concurrency/process concerns** (Process view) or justify an architecture against named use cases (the Scenarios view) — e.g., a regulator or an architecture review board asking "walk me through how this design handles the peak-order-day scenario."

A related artifact: a **Software Requirements Specification (SRS)** is the precursor document — the *what/why* (functional + non-functional requirements) that a Software Architecture Document (using C4 or 4+1) then answers with a *how*.

**Interview follow-up:** *"Your team already has a C4 diagram — why would you still produce a 4+1 view for a project?"* → Because C4 doesn't have a dedicated lens for runtime concurrency or for validating the design against specific end-to-end scenarios; if the project has non-trivial threading/process concerns, or the architecture needs sign-off against named use cases, 4+1's Process and Scenarios views say something C4 structurally can't.

## 4. Creational patterns

| Pattern | Problem it solves | Reach for it when | Trade-off / gotcha | Seen in |
|---|---|---|---|---|
| **Singleton** | Guarantee exactly one instance, globally accessible | Shared stateless resource (connection pool, config) that must not be duplicated | Hides a dependency behind a static call (hurts testability), hard to subclass, and naive lazy-init is **not thread-safe** without extra work | `Runtime.getRuntime()`, `DriverManager` |
| **Factory Method** | Defer "which concrete class" decision to a subclass/method | Object creation logic varies by input or needs to be centralized/mockable | One extra layer of indirection for callers to learn | `Calendar.getInstance()` |
| **Abstract Factory** | Produce *families* of related objects without specifying concrete classes | You need to swap an entire family of related implementations together (e.g., Windows vs. Mac UI widget sets) | Adding a new product to the family means touching every concrete factory | EJB container resolves resources via `javax.naming` (JNDI) acting as an abstract factory for EJB homes/resources |
| **Builder (incl. Fluent Builder)** | Construct a complex object step by step, avoiding telescoping constructors | Object has many optional parameters/combinations | Adds a builder class to maintain per product; fluent chains can hide validation-ordering bugs if steps are order-dependent | Used heavily where a 3rd-party API is wrapped — the fluent builder also doubles as the seam where you can validate/translate inputs before they hit the underlying library |
| **Prototype** | Create new objects by cloning an existing instance instead of `new` + reconfigure | Object construction is expensive or the only practical way to get a pre-configured instance is to copy one | `Cloneable` in Java is a famously broken contract (shallow clone by default, no clone constructor requirement) — easy to get wrong | `Object.clone()` via `Cloneable` |

**Singleton deep dive — the double-checked locking story:** naive lazy singleton (`if (instance == null) instance = new Foo();`) is not thread-safe — two threads can both pass the null check before either assigns. Double-checked locking (`synchronized` block *inside* the null check, with a second null check inside the lock) tries to avoid locking on every call, but before the Java 5 memory model fix, this was **still broken** — a thread could see a non-null reference to a partially-constructed object (reordered writes). Marking the field `volatile` (Java 5+) fixes it by establishing a happens-before relationship. The genuinely safe, boilerplate-free alternative that sidesteps all of this is an **enum singleton** (`enum Foo { INSTANCE; }`) — the JVM guarantees enum instance creation is thread-safe and serialization-safe for free.

**Interview follow-up:** *"What's wrong with using Singleton for a service that has test coverage?"* → It hides a hard dependency behind a static accessor, so tests can't substitute a mock without resorting to reflection or static-mocking frameworks; it also can't be subclassed/decorated for a test double, and if the singleton holds mutable state, tests become order-dependent through shared global state. The fix is almost always dependency injection with a singleton-scoped bean, which keeps "exactly one instance" without the static-access coupling.

## 5. Structural patterns

| Pattern | Problem it solves | Reach for it when | Trade-off / gotcha | Seen in |
|---|---|---|---|---|
| **Adapter** | Translate one interface into another the client expects | Integrating a 3rd-party library whose interface doesn't match your domain's abstraction | Thin adapters are nearly free; "fat" adapters doing real translation logic can hide bugs behind an innocent-looking interface | AWT event listener adapters |
| **Decorator** | Attach responsibilities to an object dynamically, without subclassing | You need to compose optional behaviors (logging, caching, auth) around a core implementation, potentially in different combinations | Deep decorator chains get hard to debug (stack traces through N wrapper layers) | REST wrapper classes performing a PID-based context switch around a core service call before delegating |
| **Proxy (Remote / Virtual)** | Control access to an object — stand in for it | Remote proxy: object lives elsewhere (RMI stub). Virtual proxy: object is expensive to create, so defer creation until first real use | Adds a layer that can silently swallow or translate errors from the real subject if not careful | RMI stubs are textbook remote proxies |
| **Composite** | Treat individual objects and compositions of objects uniformly (tree structures) | UI widget hierarchies, org charts, any part-whole tree where client code shouldn't care if it's a leaf or a branch | Can make it awkward to add operations that only make sense for leaves or only for composites | AWT `Container` (itself a `Component`, holding child `Component`s) |
| **Bridge** | Decouple an abstraction from its implementation so the two can vary independently | You have an abstraction that needs to work across multiple platform-specific implementations | Adds an extra indirection layer up front, before you may even have the second implementation to justify it | AWT peer classes (e.g., `Button` abstraction, platform-specific `ButtonPeer` implementation) |
| **Flyweight** | Share common state across many fine-grained objects to cut memory | You have a huge number of similar objects where most state is shared/immutable and only a small part varies per-instance | Requires a clean split between intrinsic (shared) and extrinsic (per-call) state — retrofitting this split into existing code is invasive | — |
| **Session Façade** | Provide a single coarse-grained entry point over a set of fine-grained operations | A client (e.g., another tier) should not need to orchestrate multiple fine-grained calls itself | Risks becoming a dumping ground for unrelated orchestration logic (see the SRP/EJB Façade anti-pattern above) | Bank transfer example — one Façade method debits one account and credits another behind a single transactional call, instead of exposing debit/credit as separate remote calls |

**Interview follow-up:** *"When would you choose Decorator over just subclassing?"* → When the behaviors need to compose at runtime in different combinations (e.g., logging + caching, or caching alone, decided per request/config) rather than being fixed at compile time — subclassing gives you one fixed combination per class, and the number of subclasses explodes combinatorially (`LoggingCachingService`, `CachingService`, `LoggingService`...) while Decorator lets you wrap in whatever order you need.

## 6. Behavioral patterns

| Pattern | Problem it solves | Reach for it when | Trade-off / gotcha | Seen in |
|---|---|---|---|---|
| **Template Method** | Fix the skeleton of an algorithm, let subclasses override specific steps | Multiple variants of a process share the same overall shape but differ in a few steps | Subclasses are coupled to the exact step-call sequence the base class defines — hard to reorder later | — |
| **Strategy** | Make an algorithm/behavior swappable at runtime, chosen by the caller | You have several interchangeable ways to do the same job (sorting, pricing, formatting) and want to pick one without `if/else` branching | Caller must know which strategy to pick — the pattern moves the decision, it doesn't remove it | Transformer logic that converts between different SMM object types — one `Strategy` implementation per object-type pair, selected at runtime |
| **State** | Let an object alter its behavior when its internal state changes, as if it changed class | An object's behavior forks heavily based on a lifecycle/status field, and the fork logic is scattered across many methods | Each state transition has to be modeled as an explicit class — overkill for 2-3 simple states, where a plain enum/if-check is more readable | — |
| **Chain of Responsibility** | Pass a request along a chain of handlers until one handles it | You want to decouple the sender of a request from the (possibly varying) set of handlers, e.g., layered validation/filter pipelines | If no handler in the chain actually handles the request, failures can be silent unless you add an explicit terminal handler | Servlet filter chains are the standard real-world example of this shape |
| **Observer** | Notify dependents automatically when subject state changes | Multiple parts of a system need to react to one event source without being tightly coupled to it | `java.util.Observer`/`Observable` (now deprecated) had no ordering guarantees and made debugging "who reacted to this and why" hard — prefer explicit event buses or reactive streams today | `java.util.Observer`/`Observable` |
| **Command** | Encapsulate a request as an object, so it can be queued, logged, or undone | You need undo/redo, deferred execution, or to parameterize UI actions with the operation they trigger | Every operation becomes a class — fine for a handful of commands, noisy for dozens | Swing `Action` objects |
| **Memento** | Capture and externalize an object's internal state so it can be restored later, without violating encapsulation | Undo/rollback functionality where the originator shouldn't expose its internals to the caretaker | Storing full snapshots can be memory-heavy for large objects/long undo histories | Conceptually mirrors how EJB container-managed entity state is captured/restored across activation and passivation |

**Interview follow-up:** *"Strategy vs. State — aren't they structurally identical (an interface + several implementations)?"* → Structurally, yes. The difference is intent and lifecycle: Strategy implementations are typically chosen once per call by an external caller and are stateless/interchangeable; State implementations represent one node in an object's own lifecycle and the *object itself* transitions between them (often the state object decides the next state). If you find your "Strategy" implementations referencing each other to decide "what comes next," you've actually built State.

## 7. Inheritance vs. composition vs. delegation

**Inheritance** is appropriate only when the "is-a" relationship holds at the level of **behavioral substitutability** (see LSP above) — not just taxonomically. **Composition** ("has-a") is the safer default: build behavior by holding a reference to another object and delegating to it, which avoids LSP traps entirely and doesn't lock you into a single base class (Java has no multiple inheritance of implementation).

**Delegation vs. inheritance:** delegation is composition used specifically to reuse an implementation while presenting (optionally) the same interface as the delegate — e.g., `ForwardingList` wrapping a `List` and forwarding most calls, overriding only a few. The advantage over inheritance: you can delegate to a different concrete implementation at runtime, and you don't inherit *all* of the base class's behavior whether you want it or not — you cherry-pick.

**Interview follow-up:** *"Why does 'favor composition over inheritance' matter in practice, not just in theory?"* → Because inheritance couples a subclass to the base class's implementation details across versions — a base-class change can silently break subclasses that depend on its internal call order (the fragile base class problem). Composition only couples you to the delegate's public interface, which is a much smaller, more stable surface to depend on.

## 8. CQRS (Command Query Responsibility Segregation)

**Problem it solves:** a single schema optimized for writes (normalized, fast consistent writes) is usually bad for reads (requires many joins), and vice versa (a denormalized read-optimized schema is expensive/error-prone to keep consistent on write).

**Reach for it when** (the notes frame this as a checklist — CQRS earns its complexity when *several* of these are true at once, not just one):
- Read and write load differ significantly and need to scale independently.
- Availability matters more than strict consistency, and eventual consistency is acceptable.
- The domain is genuinely complex (DDD-modeled) — plain CRUD doesn't fit the business logic.
- You're already doing (or heading toward) event sourcing.

**Trade-off/gotcha:** CQRS is one of the harder scaling techniques to execute well — it's a real architectural commitment (separate read/write models, a projection/sync mechanism, eventual consistency to manage), not a quick win. If you're simply read-constrained, a **read replica** is a much cheaper, lower-risk first step — try that before reaching for full CQRS.

**Interview follow-up:** *"Your product manager asks why the order list sometimes doesn't show an order that was 'just placed.' You're using CQRS — what's your answer, and how do you fix it if it's unacceptable?"* → That's the expected eventual-consistency lag between the write model and the read-model projection. If it's unacceptable for that specific critical path, don't rearchitect the whole system — add a **synchronous projection** for that one read model (update it in the same transaction as the write, at the cost of added write latency) while keeping other, less critical read models eventually consistent.

## 9. Event Sourcing

**Problem it solves:** storing current-state rows loses history — you can't answer "what was the state at time T" or produce a reliable audit trail without separately logging every change.

**Reach for it when:**
- A complete, reliable audit trail is a hard business requirement (banking balances, order lifecycle/history).
- You need to query system state as of an arbitrary point in time.
- Business logic is naturally expressible as a sequence of events.
- You anticipate needing new insights from historical data you haven't thought to capture yet.
- You're already pairing it with CQRS for read/write separation.

**Trade-off/gotcha — the inventory example:** event-sourced read models (current stock level) are typically updated **asynchronously**, so there's a window where the read model lags the true event history. In inventory, that window causes overselling (two customers both see "in stock" for the last unit), stale reports, and race conditions on concurrent writes. The mitigation isn't to abandon event sourcing — it's to **tier your read models by consistency need**: a synchronously-updated, strongly consistent model for the checkout stock-check path, and a cheaper eventually-consistent model for dashboards/reporting.

**Interview follow-up:** *"If event sourcing causes overselling risk, why would anyone use it for inventory at all?"* → Because the alternative — a single mutable "current stock" row — gives you none of the audit trail, replay, or point-in-time query capability, and the overselling risk is manageable by applying synchronous projections or optimistic-concurrency checks specifically on the hot "decrement stock" path, while leaving the rest of the system eventually consistent.

## 10. Event ordering & idempotency (Idempotent Receiver pattern)

**Problem it solves:** in any event/message-driven design, messages can arrive out of order (parallel consumers, retries, partitioned brokers) or be delivered more than once (at-least-once delivery, retried sends) — code that assumes neither can fail silently or corrupt state.

**Patterns for ordering:**
- **FIFO queues** where strict order matters and throughput needs are modest.
- **Partition-by-key** (e.g., Kafka partitioning by aggregate ID) — guarantees order *within* a partition/key, not globally; good enough for most domain-event use cases since you typically only need ordering per-aggregate (e.g., per order, per account).
- **Sequence numbers/timestamps** carried in the event payload so a consumer can detect and reorder (or reject) out-of-order arrivals itself, independent of broker-level guarantees.

**Pattern for duplication — Idempotent Receiver:** design the consumer so that processing the same event twice produces the same end state as processing it once (e.g., `UPSERT` keyed by event ID, or a dedup table of processed event IDs checked before acting). This is the single most load-bearing property in event-driven designs — without it, retries (which you need for resilience) become a correctness hazard.

**Interview follow-up:** *"A consumer processed 'UserUpdated' before 'UserCreated' for the same user ID — walk me through two different ways to handle it."* → (1) **Retry/delay queue:** detect the missing prerequisite (user not found), park the event in a delayed queue, retry after a backoff — simple to bolt onto an existing system, costs you an extra queue and some latency. (2) **Promise/pending state:** save the update against a placeholder "pending" record immediately, and reconcile once the create event arrives — avoids the retry infrastructure but adds a permanent "pending" state to your domain model that has to be designed and tested. Pick (1) for a quick fix to an existing system; design toward (2) only if you know this ordering race is common enough to be a real recurring case during initial design.

## 11. Anti-patterns catalog (fast recall)

| Anti-pattern | What it looks like |
|---|---|
| **Big Ball of Mud** | No discernible architecture — everything depends on everything |
| **God Object** | One class/module knows/does far too much (SRP violation taken to the extreme) |
| **Anemic Domain Model** | Domain objects are pure data bags; all behavior lives in separate "service" classes |
| **Spaghetti Code** | Tangled, unstructured control flow with no clear separation of concerns |
| **Shotgun Surgery** | A single conceptual change requires touching many unrelated classes/files |
| **Lava Flow** | Dead/obsolete code kept around because nobody's sure it's safe to delete |
| **Cargo Cult Programming** | Patterns/practices copied without understanding why they were needed |

**Interview follow-up:** *"How do Anemic Domain Model and God Object relate to each other?"* → They're often two halves of the same underlying problem: when behavior is stripped out of domain objects (Anemic Domain Model), it has to live *somewhere* — usually in a small number of oversized "manager"/"service" classes that end up accumulating unrelated responsibilities, becoming God Objects. Fixing one often means pushing behavior back onto the domain objects it was stripped from.

## 12. UML diagram types (quick reference)

| Diagram | Captures |
|---|---|
| Class | Static structure — classes, attributes, relationships |
| Object | A snapshot of actual instances at runtime |
| Package | How classes are grouped into packages/modules |
| Use Case | Actor-to-system interactions, at a functional/requirements level |
| Sequence | Time-ordered message exchange between objects for one scenario |
| Collaboration | Same information as Sequence, organized around object relationships instead of time |
| Activity | Workflow/control-flow logic (closer to a flowchart) |
| Component | Structure/dependencies between deployable components (maps to C4 Container/Component) |
| Deployment | Physical/infrastructure topology (maps to C4 Container, physical layer) |

## 13. Analysis patterns vs. design patterns

Martin Fowler's distinction: a **design pattern** solves a recurring *implementation* problem (Singleton, Observer); an **analysis pattern** captures a recurring *domain-modeling* problem — a reusable way to model a business concept (e.g., modeling "Party" as a supertype of Person/Organization so downstream code doesn't need to know which one it's dealing with). The practical interview distinction: design patterns are about *how you build it*, analysis patterns are about *how you model the domain before you build anything*.

**HLD vs. LLD, mapped to C4:** High-Level Design maps roughly to C4's Context/Container levels (system boundaries, deployable units, integrations) — architecture-style decisions belong here (see [Architecture-Notes.md](Architecture-Notes.md)). Low-Level Design maps to C4's Component/Code levels — this is where everything in this file (SOLID, GoF patterns) actually gets applied.

A brief process note worth keeping in your back pocket: notes on **TDD/XP** frame tests as a *design* tool, not just a verification tool — writing the test first forces an interface decision (what does calling this look like?) before an implementation decision, which is a cheap way to catch ISP/DIP violations before they're built.
