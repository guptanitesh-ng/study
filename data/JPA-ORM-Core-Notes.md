# JPA and ORM Core Notes

Reviewed: October 31, 2026. Source: two personal notes documents, dated 27-28 May 2019 (`ORM.pdf`, `JPA.pdf`), written while working with JPA under EJB containers rather than Spring Data.

These are framework-agnostic JPA/Hibernate spec notes: entity rules, lifecycle, locking, caching, inheritance and JTA. None of it is Spring Data specific, so it lives here rather than inside [Spring-Data-Notes.md](../spring/Spring-Data-Notes.md), which stays focused on Spring's repository/transaction abstractions over this same spec. Read this doc first if your hands-on JPA experience predates Spring Data (for example, container-managed persistence in EJB); it gives you the vocabulary to reframe that experience in Spring Boot/Spring Data terms rather than starting from zero.

This is an editorial conversion, not a verbatim transcript: outdated package names, deprecated APIs and a couple of oversimplified claims from the 2019 notes are corrected inline.

Companion guides: [Spring Core](../spring/Spring-Core-Notes.md), [Spring Boot](../spring/Spring-Boot-Notes.md), [Spring Data](../spring/Spring-Data-Notes.md), [SQL](SQL-Notes.md).

## Contents

1. JPA vs Hibernate vs JDO
2. Entity fundamentals: rules, access types, keys, embeddables
3. Relationships and the Many-to-Many `List` vs `Set` pitfall
4. Inheritance mapping strategies
5. Entity lifecycle and the `EntityManager` API
6. Fetching strategies and the one-to-one N+1 trap
7. Locking: optimistic and pessimistic
8. Caching: first-level, second-level, and query cache
9. Transactions the EJB way: JTA, 2PC/XA, persistence-context scope
10. Querying: JPQL, Criteria API, polymorphism
11. Annotation reference and lifecycle callbacks
12. `EntityGraph`, `Cache`, and `Metamodel` interfaces
13. ORM vs plain JDBC
14. JPA 2.1 and later: what actually changed
15. Bridging this to Spring Boot / Spring Data interviews
16. Interview questions

## 1. JPA vs Hibernate vs JDO

JPA (Jakarta Persistence, formerly Java Persistence API) is a **specification**: a set of interfaces and annotations (`EntityManager`, `@Entity`, JPQL, etc.). Hibernate, EclipseLink and OpenJPA are **providers** that implement it. JDO (Java Data Objects) is an older, more general persistence spec (not relational-only) that largely lost mindshare once JPA standardized ORM; you won't be asked to write JDO, but recognizing the name in a "history of persistence" question is enough.

**Correction:** the original notes used `javax.persistence.*` imports throughout. Jakarta EE 9+ (and all current JPA/Hibernate versions you'll meet in interviews) uses `jakarta.persistence.*`. Say "Jakarta Persistence" rather than "the javax API" unless you're explicitly discussing a pre-2020 codebase.

Hibernate predates JPA and still ships Hibernate-native APIs (`Session`, `SessionFactory`, native `Criteria`) alongside the portable JPA ones (`EntityManager`, `EntityManagerFactory`, JPA `CriteriaBuilder`). Prefer the portable API in interview answers unless asked specifically about Hibernate internals, since that's also what Spring Data JPA builds on.

## 2. Entity fundamentals: rules, access types, keys, embeddables

**An entity class must, at minimum:**

- Be annotated `@Entity`.
- Have a no-argument constructor (can have others too); the provider needs it to instantiate entities via reflection.
- Not be declared `final`, and not have `final` methods/fields mapped for persistence — most providers use runtime proxies/bytecode enhancement for lazy loading, and `final` blocks that.
- Have a persistent identifier field annotated `@Id` (and typically `@GeneratedValue` for surrogate keys).
- Not be an interface or enum (the entity itself; enums are fine as *attribute* types).
- Avoid primitive arrays/collections of entities without proper mapping annotations (`@OneToMany` etc. instead of a raw array of entities).
- Persistent fields should not be `public` without accessors in field access mode — mixing access strategies on one hierarchy without `@Access` overrides gets confusing fast.
- Avoid business/equality logic in `equals()`/`hashCode()` based on a generated ID before it's assigned (classic trap: two transient instances with `id == null` compare equal under naive implementations); prefer a natural business key, or implement equals/hashCode carefully around detached/managed/transient states.

**Access type** (`@Access(AccessType.FIELD)` or `@Access(AccessType.PROPERTY)`) determines whether the provider reads/writes through fields directly or via getters/setters. Mixed access in one entity is possible with per-field `@Access` overrides but adds cognitive overhead — pick one strategy per hierarchy unless you have a specific reason (e.g., a computed/derived getter that needs `@Transient` plus a property-access override).

**Valid `@Id` types:** primitives and their wrappers, `String`, `java.util.Date`/`java.sql.Date`, `BigDecimal`/`BigInteger`, and any `Serializable` type used consistently. Composite keys use either `@EmbeddedId` (a dedicated `@Embeddable` key class) or `@IdClass` (a separate class mirroring the entity's `@Id` fields). Prefer `@EmbeddedId` for new code — it keeps the key as a reusable value object instead of duplicating field declarations across the entity and the ID class.

**`@Embeddable`** types (e.g., `Address`, `Money`) have no identity of their own; they're embedded into an owning entity's table via `@Embedded`, optionally with `@AttributeOverrides` to rename columns when the same embeddable is reused in multiple entities with colliding column names.

## 3. Relationships and the Many-to-Many `List` vs `Set` pitfall

Four relationship types, each uni- or bidirectional:

| Relationship | Owning side has | Inverse side (if bidirectional) |
|---|---|---|
| `@OneToOne` | `@JoinColumn` (foreign key) | `mappedBy` pointing back |
| `@OneToMany` | Usually the "many" side owns the FK; an inverse-only `@OneToMany` needs a join table unless `mappedBy` is used | `mappedBy` on the "many" side's `@ManyToOne` |
| `@ManyToOne` | `@JoinColumn` | n/a (this is usually the owning side of a one-to-many pair) |
| `@ManyToMany` | Either side can own; one side declares the join table, the other uses `mappedBy` | — |

Only the **owning side**'s changes are reflected in the database for bidirectional associations; updating only the inverse side's in-memory collection without also updating the owning side is a classic bug ("I added to the list but nothing was inserted").

**The Many-to-Many `List` vs `Set` pitfall** (from `ORM.pdf`): when a `@ManyToMany` or `@OneToMany` collection is mapped as a `List` *without* an explicit `@OrderColumn`, and more than one such collection exists on the same entity, Hibernate historically had to delete-and-reinsert the entire join-table collection rows to keep positional indices consistent on certain modifications — a correctness/performance surprise, not just a style choice. Practical guidance that still holds:

- Use `Set` for `@ManyToMany` collections unless you genuinely need list semantics (duplicates, positional order).
- If you need stable order, use `@OrderColumn` (persisted ordinal) or `@OrderBy` (ORDER BY clause at read time, doesn't require a stored column) rather than relying on insertion-order `List` behavior.
- Having **multiple unordered bag-style (`List` without `@OrderColumn`) collections on one entity** is the configuration most likely to trigger `MultipleBagFetchException` when you try to eagerly fetch more than one of them in the same query — recognize this error message, it comes up in real codebases, not just interviews.

## 4. Inheritance mapping strategies

Three JPA inheritance strategies, each with real trade-offs (not just syntax):

| Strategy | Tables | Trade-off |
|---|---|---|
| `SINGLE_TABLE` (default) | One table for the whole hierarchy, with a discriminator column | Fastest reads (no joins/unions); nullable columns for subclass-specific fields; wide tables |
| `JOINED` | One table per class, joined on PK | Normalized, no nullable-column sprawl; reads/writes need joins, can be slower at scale |
| `TABLE_PER_CLASS` | One table per concrete class, duplicating inherited columns | No joins per class, but polymorphic queries across the hierarchy require `UNION`s; IDs commonly need an application-assigned or table-based generator since `IDENTITY` can't be portably shared across tables |

`@MappedSuperclass` is a fourth, different thing: it's **not** part of the entity hierarchy for query/polymorphism purposes — it has no own table and can't be queried polymorphically. It just lets multiple otherwise-unrelated entities share mapped fields (e.g., `createdAt`/`updatedAt` audit columns) via plain inheritance, without implying an `@Entity` "is-a" relationship in JPQL.

## 5. Entity lifecycle and the `EntityManager` API

Four entity states, and what each `EntityManager` operation does to them:

| State | Meaning |
|---|---|
| New / transient | Instantiated, not associated with any persistence context, no row yet |
| Managed | Tracked by a persistence context; changes are detected and flushed automatically |
| Detached | Was managed, persistence context closed/cleared/entity evicted; no further automatic tracking |
| Removed | Marked for deletion within the current persistence context; row deleted at flush/commit |

| Operation | New → | Managed → | Detached → | Removed → |
|---|---|---|---|---|
| `persist()` | Becomes managed | No-op (already managed) | Throws (`EntityExistsException` or similar, provider-dependent) | Un-marks removal, becomes managed again |
| `merge()` | Copies state into a *new* managed instance, returns it; original stays transient | Returns the same managed instance (no-op on its own state, cascades per `MERGE`/`ALL`) | Copies state into a managed instance, returns it; original stays detached | Throws (`IllegalArgumentException`) |
| `remove()` | Throws (`IllegalArgumentException`) | Becomes removed | Throws | No-op |
| `refresh()` | Throws | Reloads from DB, overwriting in-memory changes | Throws | Throws (undefined/provider-dependent) |
| `detach()` | No-op | Becomes detached | No-op | Becomes detached |

Note the same `merge()` subtlety called out in the Spring Data notes: it never mutates the argument you pass for an already-detached/new entity — you must use the **returned** instance for further tracked work. This is a spec guarantee, not a Spring Data convenience.

`persist()` returns `void`; there is no spec-level `save()`. (Hibernate's native `Session.save()` is a different, deprecated-since-6.x API — see [Spring-Data-Notes.md §4](../spring/Spring-Data-Notes.md#4-jpa-state-and-entitymanager) for the full comparison against Spring Data's `save()`.)

## 6. Fetching strategies and the one-to-one N+1 trap

`FetchType.LAZY` is generally a provider hint; `EAGER` is a requirement that the state be available eagerly, not a promise of a single SQL join. The defaults are `LAZY` for `@OneToMany`/`@ManyToMany` and **`EAGER` for `@OneToOne`/`@ManyToOne`**. Loading many parents can therefore trigger N additional selects; inspect the actual SQL and use a fetch join, an entity graph, or suitable batching. On the inverse side of an optional one-to-one, the foreign key is in the other table: the provider may need a query just to discover whether a child exists. Lazy to-one support and bytecode enhancement are provider-specific; verify their effect rather than assuming `LAZY` alone fixes N+1.

## 7. Locking: optimistic and pessimistic

**Do not equate MVCC with optimistic conflict detection.** MVCC provides visibility through row versions; its precise snapshots and conflict rules depend on the database and isolation level. `@Version` adds a version check for updates to that entity. JPA `PESSIMISTIC_*` requests database locks, often using `SELECT ... FOR UPDATE`; conflicting lock requests may wait or time out, but ordinary MVCC readers can often read an earlier committed version even while a row is exclusively locked. Exact lock strength and reader behavior are database/provider-specific.

That engine-level behavior is governed by the connection's **isolation level**, independent of JPA's lock modes — isolation controls what a plain `SELECT` is allowed to see while other transactions are in flight; locking controls what you do about a conflict once you've decided to prevent or detect it:

| Isolation level | Dirty read | Non-repeatable read | Phantom read | JDBC constant |
|---|---|---|---|---|
| `READ_UNCOMMITTED` | Possible | Possible | Possible | `Connection.TRANSACTION_READ_UNCOMMITTED` (1) |
| `READ_COMMITTED` | Prevented | Possible | Possible | `Connection.TRANSACTION_READ_COMMITTED` (2) |
| `REPEATABLE_READ` | Prevented | Prevented | Possible (standard-defined; some MVCC engines also block most phantoms in practice) | `Connection.TRANSACTION_REPEATABLE_READ` (4) |
| `SERIALIZABLE` | Prevented | Prevented | Prevented | `Connection.TRANSACTION_SERIALIZABLE` (8) |

- **Dirty read**: transaction A reads a row transaction B has modified but not yet committed; if B rolls back, A read data that never existed.
- **Non-repeatable read**: A reads the same row twice in one transaction and gets different values because B committed an update to it in between.
- **Phantom read**: A re-runs the same range query twice and gets a different *set of rows* because B inserted/deleted a row matching the predicate in between.
- **Lost update**: A and B both read the same row, both write back based on that stale read, and one write silently overwrites the other — this is exactly the anomaly `@Version`-based optimistic locking exists to catch (the second writer gets `OptimisticLockException` instead of silently clobbering the first).
- **Write skew**: A reads a value and writes based on it, B does the same for a *different but related* row, and both commit even though the combination violates an invariant neither transaction's individual write-set would catch on its own — the classic failure mode `SERIALIZABLE` (or an explicit application-level check/constraint) guards against, since optimistic locking on either row alone doesn't see the cross-row invariant.

Spring's default isolation delegates to the underlying connection/database default; it is **not universally `READ_COMMITTED`**. Check the actual database and configuration before choosing a stronger isolation or targeted locking.

**Write-skew timeline:** two doctors are on call; the invariant requires at least one. Concurrent transactions each see both on call, then each updates a different doctor's row to off call. Under an isolation level that permits write skew, both can commit and nobody remains on call. A separate `@Version` on each row doesn't conflict. Protect the shared invariant with an appropriate constraint or shared lock, or use database `SERIALIZABLE` and retry transactions aborted for serialization conflicts.

**Optimistic locking** (`@Version` on a numeric or timestamp column): every update checks the version column in the `WHERE` clause and bumps it; zero rows affected means someone else updated first, surfaced as `OptimisticLockException`. No DB-level lock held between read and write — cheap, but the conflict is only detected at commit/flush time, and the losing side must decide to retry or report a conflict to the user. This also makes it the natural fit for detached-entity/web-tier flows (edit form → submit later): there's no lock held across the request boundary the way a pessimistic lock would require.

`@Version` field rules (spec-level, not Hibernate-specific): the type must be one of `int`/`Integer`/`long`/`Long`/`short`/`Short`/`java.sql.Timestamp`; an entity may declare **exactly one** version attribute; for an entity mapped across a primary and secondary table, the version attribute must live in the **primary table**; and the application must never manually set or increment it — that's the provider's job, every time.

Recovering from `OptimisticLockException`: since the exception can mark the current transaction rollback-only, the standard pattern is reload/refresh the entity — preferably in a **new** transaction — before retrying the update, not just retry inside the same (possibly already-doomed) transaction.

**Pessimistic locking**: acquires a DB-level lock (`SELECT ... FOR UPDATE` or equivalent) up front, blocking other transactions from acquiring a competing lock until commit/rollback. Full `LockModeType` enum:

| Mode | Behavior |
|---|---|
| `NONE` | No lock requested |
| `OPTIMISTIC` (was `READ`) | Checks version at commit without extra locking |
| `OPTIMISTIC_FORCE_INCREMENT` (was `WRITE`) | Like `OPTIMISTIC`, but forces a version increment even without a detectable field change — use when a *relationship* change should still trigger optimistic conflict detection on the parent. The spec leaves the increment's exact timing unspecified: a provider may apply it at flush time or defer it to commit. |
| `PESSIMISTIC_READ` | Shared lock; blocks concurrent writers, typically allows concurrent readers (DB-dependent) |
| `PESSIMISTIC_WRITE` | Exclusive lock; blocks concurrent readers and writers requesting a lock |
| `PESSIMISTIC_FORCE_INCREMENT` | Exclusive lock plus forced version bump |

You can request a lock mode via `find(Class, id, LockModeType)`, `Query`/`TypedQuery.setLockMode()`, `lock(entity, LockModeType)` on an already-managed entity, `refresh(entity, LockModeType)`, or on a `NamedQuery` via the `lockMode` element — recognize all five entry points, since "how would you acquire a pessimistic lock" answers are usually graded on knowing there's more than one way.

**Lock scope** (`PessimisticLockScope`): `NORMAL` locks only the entity's own row; `EXTENDED` also locks rows in any joined collection tables mapped by that entity — relevant when a parent's locked state should also block changes to a dependent join table.

**Lock timeout**: set via the standard `jakarta.persistence.lock.timeout` property (milliseconds; `0` means no-wait/fail-fast, a negative value typically means block indefinitely, both provider-interpreted). Always have an explicit timeout policy in a high-concurrency system — unbounded blocking pessimistic locks are a common source of production deadlocks/thread-pool exhaustion, which is exactly why "avoid synchronization constructs" instincts from plain Java carry over here: DB locks have the same contention cost as `synchronized`, just distributed across connections instead of threads.

**Pessimistic lock-failure exceptions aren't interchangeable in rollback scope**: `PessimisticLockException` marks the whole **transaction** for rollback (the failure is transaction-level); `LockTimeoutException` is narrower — only the failing **statement** is affected, so the transaction can still continue and retry the same operation; anything else provider-specific surfaces as a plain `PersistenceException`. Knowing which one you caught tells you whether "just retry" is even possible without a fresh transaction.

## 8. Caching: first-level, second-level, and query cache

**First-level cache** is the persistence context itself — always on, scoped to one `EntityManager`, not configurable off. This is what makes `find()` return the *same* managed instance for a repeated call with the same ID inside one transaction, and what dirty-checking relies on at flush.

**Second-level (L2) cache** is shared across persistence contexts/the whole `EntityManagerFactory`, provider-specific to configure (Hibernate: Ehcache/Infinispan/Caffeine region factory), and entirely opt-in per entity via `@Cacheable` plus the persistence-unit `shared-cache-mode`:

| `shared-cache-mode` value | Meaning |
|---|---|
| `ALL` | Cache every entity |
| `NONE` | Cache nothing (L2 effectively off even if a provider is configured) |
| `ENABLE_SELECTIVE` | Only entities marked `@Cacheable(true)` |
| `DISABLE_SELECTIVE` | Everything except entities marked `@Cacheable(false)` |
| `UNSPECIFIED` | Provider default |

**Cache concurrency strategies** (how the L2 cache handles concurrent reads/writes of a cached region), from weakest to strongest guarantee: `READ_ONLY` (immutable data only — cheapest, throws if you try to update a read-only cached entity), `NONSTRICT_READ_WRITE` (no locking, brief staleness window tolerated — fine for data where an occasional stale read is acceptable), `READ_WRITE` (uses soft locks on cache entries during a transaction to prevent genuinely stale reads), `TRANSACTIONAL` (full JTA-integrated cache transactions, needs a JTA environment and a cache provider that supports it). Pick the weakest strategy that's still correct for the entity — `READ_ONLY` for reference/lookup tables is the common, safe default; reach for `READ_WRITE` only for mutable entities that are genuinely read-heavy.

Collections can be cached too (`@Cache` on the collection-valued field/getter, same concurrency-strategy choices). Hibernate's **query cache** is a separate opt-in, for example via `setHint("org.hibernate.cacheable", true)`; JPA cache retrieve/store hints control entity cache interaction, not query-result caching itself. Result layout varies by Hibernate version and configuration: do not assume every version caches only identifiers. An identifier-only result may still need L2 hits or database loads to resolve entities. See the [Hibernate 6.5 query-cache layout migration notes](https://docs.hibernate.org/orm/6.5/migration-guide/).

**Why this matters in interviews beyond definitions:** each entity or cached collection has a region; a cached collection of entities typically tracks membership/identifiers, not independent freshness of every entity's state. Query results also depend on invalidation metadata for the affected tables. A frequently updated table can invalidate a popular query repeatedly, so caching it may add overhead with few hits; measure region hit/miss and database load.

**Stale-data scenario:** a product is cached, then a reporting job updates its price directly through JDBC or another application. Hibernate cannot automatically observe that external write, so entity, collection or query regions may remain stale. Hibernate-managed JPQL/HQL bulk operations and native SQL have different synchronization/invalidation behavior; for native queries, declare affected query spaces where the API/version supports it, or explicitly evict the affected regions. Coordinate external writers and evictions after commit, and test the exact provider/version and cache topology. Also clear or refresh the current persistence context when bulk DML leaves already-managed objects stale: evicting L2 alone does not refresh L1. Caching is not a substitute for a consistency contract or locking.

## 9. Transactions the EJB way: JTA, 2PC/XA, persistence-context scope

This section is deliberately framed around your actual background — container-managed JPA in EJB — since it maps directly onto how Spring explains the same concepts, just with different vocabulary.

**JTA (Java Transaction API)** coordinates a transaction across multiple enlisted resources (e.g., two different databases, or a database plus a JMS queue) via a **transaction manager** acting as coordinator and resource managers implementing the **XA** protocol. **Two-phase commit (2PC)**: phase 1, the coordinator asks every enlisted resource to *prepare* (durably record it can commit); phase 2, once all resources vote "yes," the coordinator tells all of them to *commit* (or, if any voted "no," tells all to *rollback*). This is what gives you atomicity across heterogeneous resources — and its real cost: XA resources are slower (extra round trips, durable prepare records) and a coordinator crash between phase 1 and phase 2 can leave a resource "in doubt" until manual/automatic recovery — which is why most single-database Spring Boot apps deliberately avoid JTA/XA and use a local `JpaTransactionManager` instead (see [Spring-Data-Notes.md §2](../spring/Spring-Data-Notes.md#2-transaction-managers-and-boundaries)), reserving JTA for the genuine multi-resource case.

**Where ACID fits in:** 2PC is specifically how JTA protects **atomicity** across multiple enlisted resources (all commit or none do), and transitively their individual **durability** (each resource's own commit record survives a crash once phase 2 completes). **Consistency** (your invariants hold before and after) is mostly an application/schema-constraint concern that 2PC doesn't buy you by itself; **isolation** is the connection-level setting from §7, orthogonal to whether 2PC is involved at all. A single-resource local transaction (`JpaTransactionManager`) gets atomicity, isolation, and durability from that one database engine for free and never needs 2PC — you only pay 2PC's extra-round-trip, in-doubt-on-crash cost when atomicity has to span more than one resource manager.

**JTA with vs. without Jakarta EE**: inside a full Jakarta EE/application-server container, JTA's `UserTransaction`/container-managed transactions are provided automatically and EJBs get declarative transaction demarcation (`@TransactionAttribute`) for free. Outside a full EE container (e.g., a plain Spring Boot app), you need a standalone JTA implementation (Atomikos, Bitronix, Narayana) wired in explicitly if you actually need distributed transactions — it isn't available "for free" the way it was in your EJB container.

**Transaction-scoped vs. extended persistence context** (the EJB-specific distinction worth translating): a **transaction-scoped** persistence context (the common case, `@PersistenceContext` default) lives only as long as the active transaction — entities become detached once it commits. An **extended** persistence context (`@PersistenceContext(type = PersistenceContextType.EXTENDED)`, only valid on a stateful session bean) survives across multiple transactions within that bean's lifetime, keeping entities managed between calls — useful for a multi-step conversation/wizard flow without re-attaching entities each step, at the cost of a longer-lived, larger persistence context to manage.

**The Spring equivalent you should bridge to:** Spring doesn't have a direct "extended persistence context" concept for stateless beans — the nearest analog is Open EntityManager in View (keeps a context open for the request) or deliberately designing a longer-lived scope yourself; mention in an interview that you understand *why* EJB offered extended contexts (stateful conversational flows) even if your Spring Boot answer is "I'd model that differently, e.g. load a fresh aggregate per request and pass DTOs between steps instead of keeping entities managed across requests."

## 10. Querying: JPQL, Criteria API, polymorphism

**JPQL vs SQL:** JPQL queries entities and their mapped attributes/relationships, not tables/columns — `SELECT o FROM PurchaseOrder o WHERE o.status = :status`, not `SELECT * FROM purchase_order`. JPQL is **polymorphic by default**: querying a superclass entity type returns instances of all its mapped subclasses too (relevant for the inheritance strategies in §4) — a plain SQL query against the base table would not do this automatically for `JOINED`/`TABLE_PER_CLASS`. Native SQL (`createNativeQuery`) is available when you need DB-specific features JPQL can't express, at the cost of portability and weaker compile-time attribute checking.

**Criteria API** builds queries programmatically (`CriteriaBuilder`, `CriteriaQuery`, `Root`, metamodel-generated `_Entity` attribute classes) instead of string JPQL — valuable for dynamically composed queries (optional filters) where string concatenation would be error-prone, at the cost of significantly more verbose code. In practice, most teams reach for `@Query`/derived methods for static queries and Criteria (or Spring Data `Specification`, which wraps Criteria) only for genuinely dynamic filter composition — know when each is the right tool, not just the syntax.

## 11. Annotation reference and lifecycle callbacks

Quick-recall table for annotations that come up but rarely get their own flashcard:

| Annotation | Purpose |
|---|---|
| `@Basic` | Default/implicit mapping for simple attributes; `fetch`/`optional` attributes are rarely overridden but exist |
| `@Transient` | Field is not persisted at all (compile-time, not just a runtime hint) |
| `@AttributeOverride(s)` / `@AssociationOverride(s)` | Rename/remap columns for an `@Embeddable` or inherited `@MappedSuperclass` field reused with different column names in different entities |
| `@Convert` / `@Converts` | Registers an `AttributeConverter` to transform a Java type to/from a DB column type (e.g., an enum to a custom string code, or a value object to a column) |
| `@EntityListeners` | Registers external listener class(es) for lifecycle callbacks, as an alternative to callback methods on the entity itself |
| `@OrderBy` | Read-time `ORDER BY` for a collection; no extra stored column |
| `@OrderColumn` | A persisted ordinal column backing a `List`'s position — needed for stable order under concurrent modification, unlike `@OrderBy` alone |

**Seven lifecycle callback methods** (usable either as annotated methods directly on the entity, or in a class referenced via `@EntityListeners`): `@PrePersist`, `@PostPersist`, `@PreRemove`, `@PostRemove`, `@PreUpdate`, `@PostUpdate`, `@PostLoad`. Common real use: `@PrePersist`/`@PreUpdate` to stamp `updatedAt`, `@PostLoad` to initialize a transient derived field after the provider populates the entity.

**`@Immutable`** (Hibernate-specific, not portable JPA): tells the provider never to issue `UPDATE`s for this entity even if a field is changed in memory — useful for read-mostly reference/lookup data, but a silent trap if someone *does* mutate such an entity expecting persistence and nothing happens.

**Proxy objects:** a lazy-loaded `@ManyToOne`/`@OneToOne` association is commonly a runtime-generated subclass proxy, not the real entity instance, until a non-identifier method is accessed (which triggers the actual load). This is why `instanceof` against the exact entity class, or calling `getClass()` for an equality check, can behave surprisingly on a proxy — prefer `Hibernate.getClass()`/unproxy helpers, or JPA-portable patterns, when you need the true runtime type.

**Orphan removal vs `CascadeType.REMOVE`:** both can delete child rows, but `orphanRemoval = true` additionally deletes a child **the moment it's removed from the owning collection**, even if you never called `remove()` on the parent or the child directly — modeling true ownership ("this child cannot exist without this exact parent"). `CascadeType.REMOVE` only propagates when the parent itself is explicitly removed; it does **not** fire just because a child was unlinked from a collection. Use `orphanRemoval` for genuine composition (order → order lines); reach for plain `CascadeType.REMOVE` when the child is still independently addressable and deletion should only follow explicit parent deletion, not an in-memory collection edit.

**Real-world history (late-2000s EJB/OpenJPA projects):** `orphanRemoval` is a JPA **2.0** addition (2009) — JPA 1.0 (2006, bundled with Java EE 5) had no portable concept of it at all. Teams on JPA 1.0 providers, including early OpenJPA, could only cascade via `CascadeType.REMOVE`, which — as above — only fires on explicit parent deletion, not on unlinking a child from a collection. The practical consequence: code that did `parent.getChildren().remove(child)` and expected the DB row to go away silently left orphaned rows behind, because that pattern needs `orphanRemoval`, not `CascadeType.REMOVE`, and `orphanRemoval` simply didn't exist yet on JPA 1.0. Early JPA 2.0-era provider implementations (including OpenJPA) also had real maturity gaps once `orphanRemoval` did land — incomplete support in edge cases (nested/transitive associations, certain collection types) that caused the same symptom even after upgrading the spec version, until later provider releases caught up. This is a good concrete answer if asked "have you seen orphan management go wrong in practice?" — it's a spec-version/provider-maturity story, not a conceptual misunderstanding of cascades.

## 12. `EntityGraph`, `Cache`, and `Metamodel` interfaces

**`EntityGraph`** (`@NamedEntityGraph` or built programmatically via `EntityManager.createEntityGraph()`) is a **JPA 2.1** addition (2013). It specifies eagerly fetched attributes for a query without changing the mapping globally. With `jakarta.persistence.fetchgraph`, listed attributes are treated as eager and unlisted attributes as lazy; with `jakarta.persistence.loadgraph`, unlisted attributes retain their mapped defaults. A provider may fetch additional state, so neither graph guarantees an exact SQL shape.

```java
@Entity
@NamedEntityGraph(
    name = "Order.withLinesAndCustomer",
    attributeNodes = {
        @NamedAttributeNode("lines"),
        @NamedAttributeNode("customer")
    }
)
public class Order {
    @OneToMany(mappedBy = "order") // default LAZY, as usual
    private List<OrderLine> lines;

    @ManyToOne // default EAGER, but graph makes the intent explicit either way
    private Customer customer;
    // ...
}

// At the call site: fetch exactly what this one query needs, nothing else.
EntityGraph<?> graph = em.getEntityGraph("Order.withLinesAndCustomer");
Order order = em.find(Order.class, orderId,
        Map.of("jakarta.persistence.fetchgraph", graph));
// lines and customer come back populated in this single query (join-fetched);
// every other @OneToMany/@ManyToOne on Order not listed stays LAZY/unfetched.

// Programmatic (ad hoc) equivalent, without a @NamedEntityGraph:
EntityGraph<Order> adHoc = em.createEntityGraph(Order.class);
adHoc.addAttributeNodes("lines", "customer");
TypedQuery<Order> query = em.createQuery(
        "select o from Order o where o.status = :status", Order.class);
query.setHint("jakarta.persistence.fetchgraph", adHoc);
```

Swap `"jakarta.persistence.fetchgraph"` for `"jakarta.persistence.loadgraph"` if unlisted attributes should keep their mapped defaults, including mapped `EAGER` associations; with `fetchgraph` they are treated as lazy for graph semantics.

**`Cache` interface** (`EntityManagerFactory.getCache()`): programmatic L2 cache control — `contains(Class, id)`, `evict(Class, id)`, `evictAll()` — useful for manual invalidation after a bulk update/delete that bypasses the persistence context (see §6/Spring-Data notes on bulk operations leaving cache/managed state stale).

**`Metamodel` interface**: reflective, type-safe access to the persistence model's managed types/attributes at runtime — what the generated Criteria API `_Entity` metamodel classes are built from, and occasionally useful directly for generic/dynamic tooling (audit frameworks, generic admin UIs) that need to introspect entity structure without hardcoding attribute names.

## 13. ORM vs plain JDBC

The honest trade-off, not a one-sided pitch:

| | ORM (JPA/Hibernate) | Plain JDBC |
|---|---|---|
| Boilerplate | Low for CRUD; mapping does the row↔object translation | High: manual `ResultSet` mapping, connection/resource handling per query |
| Object graph / relationships | Native support (lazy loading, cascades) | Manual joins and manual object assembly |
| Caching | Built-in L1, optional L2/query cache | None by default; you build it yourself |
| SQL control | JPQL/Criteria abstracts it; native queries available when needed | Full, direct control |
| Performance predictability | Can be a trap (N+1, unintended eager loads) without active attention | Predictable — you wrote the exact SQL |
| Portability across DB vendors | Dialect abstraction helps | None; SQL is vendor-specific unless you abstract it yourself |

**Correction to a sometimes-overstated 2019-notes claim:** ORM doesn't eliminate the need to understand SQL/query plans — it changes *where* that understanding is applied (reading generated SQL, choosing fetch strategies, structuring entity graphs) rather than removing it. Complex reporting/analytics queries are still frequently better served by JDBC/native SQL even in an otherwise ORM-based codebase.

## 14. JPA 2.1 and later: what actually changed

From the 2019 notes' "JPA 2.1 new features" list, the durable ones worth remembering: `EntityGraph` (`@NamedEntityGraph`, `createEntityGraph()`, `fetchgraph`/`loadgraph` hints — see §12), `AttributeConverter` (`@Convert`), stored procedure support (`@NamedStoredProcedureQuery`), synchronized persistence contexts with external resource-local transactions (`@SynchronizationType`), the `CriteriaUpdate`/`CriteriaDelete` bulk-operation APIs, and schema generation properties. Since then, the bigger practical shift for interviews is the **Jakarta EE namespace migration** (`javax.persistence` → `jakarta.persistence` from Jakarta EE 9 onward) — know that this is a package rename driven by Oracle's trademark transfer of "Java EE" to the Eclipse Foundation, not a behavioral spec change, so legacy `javax`-based code isn't "wrong," just on an older namespace.

## 15. Bridging this to Spring Boot / Spring Data interviews

If asked "you haven't used Spring Data — can you still work with JPA in Spring Boot?", the accurate answer is yes, on two levels:

1. **Spring Boot + plain JPA, no Spring Data:** inject `EntityManager` directly (via `@PersistenceContext` or Framework 7's broader injection options) inside a `@Transactional` `@Service`, write JPQL/Criteria queries by hand, exactly like the EJB-container experience — just with Spring's `JpaTransactionManager` managing the transaction instead of container-managed JTA. This is a completely normal, supported pattern, not a stopgap.
2. **Spring Data JPA:** builds repository proxies *over* that same `EntityManager`/JPA layer — `save()` still resolves to `persist()`/`merge()` underneath (see [Spring-Data-Notes.md §4](../spring/Spring-Data-Notes.md#4-jpa-state-and-entitymanager)), derived query methods generate JPQL for you, and `Page`/`Slice` wrap the same count/limit-offset SQL you'd otherwise hand-write. None of your lifecycle/locking/caching/inheritance knowledge from this document becomes obsolete — Spring Data is a convenience layer on top of it, not a replacement for it.

Framing for an interview: "My production JPA experience is container-managed under EJB rather than Spring Data, but the persistence semantics — entity lifecycle, locking, caching, N+1, transaction boundaries — are the same spec either way. Spring Data's `save()`/derived queries are a thin layer over the `EntityManager` calls I've already written by hand, and I've since worked with Spring Boot + JPA directly, so adopting Spring Data's repository conventions on a new codebase is a quick ramp-up, not a gap."

### "Spring Data JPA instead of Hibernate, for portability" — what that claim actually means

A common justification for leaning on Spring Data JPA over a provider's native API: it's framed as "portability," but it's worth being precise about what's portable and what isn't, since the loose version of this claim doesn't survive a follow-up question.

- **It's a false dichotomy to start with.** Spring Data JPA is a repository/convenience layer written *against the JPA spec* — it still needs a JPA **provider** underneath to do the actual O/R mapping and SQL generation, and in the overwhelming majority of real projects that provider is Hibernate. Choosing Spring Data JPA doesn't remove Hibernate from the stack; it just means application code talks to `JpaRepository`/`EntityManager` instead of Hibernate's native `Session`/`Criteria` APIs.
- **What JPA actually makes portable is the *provider*, not the database.** In theory you could swap Hibernate for EclipseLink or OpenJPA without rewriting entities/queries, because they all implement the same spec. SQL dialect differences (pagination syntax, `LIMIT` vs `ROWNUM`, vendor functions) are abstracted by Hibernate's `Dialect` layer — a Hibernate feature, present whether or not Spring Data sits on top.
- **Honest caveat:** provider-swap portability is almost never exercised in practice. Teams pick Hibernate once and stay on it for the application's lifetime. It's a textbook answer, rarely a lived benefit — say so if asked, rather than overstating it.
- **The justification that actually holds up in practice:** less boilerplate (derived query methods, `Specification`/`Pageable`, auditing, transaction management vs hand-rolled `Session`/`Criteria` code), and team/hiring portability — more engineers know the standard `EntityManager`/Spring Data vocabulary than Hibernate-native internals, since it's the common denominator across JPA providers and Spring shops. It also avoids casual lock-in to Hibernate-specific idioms in everyday CRUD code, even though Hibernate is still doing the work underneath.
- **General real-world norm — escape hatches in order of how often they're actually reached for:**
  1. **JPQL** — the default, covers most queries.
  2. **Native SQL *inside* JPA/Spring Data** (`@Query(nativeQuery = true)`, or `JdbcTemplate`/jOOQ alongside the repository layer) — by far the most common escape hatch once JPQL can't express something cleanly (complex joins, window functions, DB-specific syntax). No new API to learn, stays inside the repository pattern.
  3. **Native Hibernate API** (`EntityManager.unwrap(Session.class)`, `StatelessSession`, `@Filter`, batch-size/flush-mode tuning) — narrower and rarer; reached for specific technical needs JPA has no portable equivalent for, not as a general query escape hatch. Note this isn't "JPA can't do bulk inserts": plain `EntityManager.persist()` in a loop with periodic `flush()`/`clear()` and `hibernate.jdbc.batch_size` set already produces real JDBC batch `INSERT`s, and that's the standard approach for moderate volumes. `StatelessSession` is reached for only when per-entity overhead from the persistence context — first-level cache growth, dirty-checking, cascades/entity-listener callbacks firing on every row — becomes a measurable problem at very large volumes (e.g. millions of rows), since it bypasses the persistence context entirely.
  4. **Raw JDBC/jOOQ** as a parallel, non-JPA path — for reporting-heavy or performance-critical reads where even native SQL inside JPA adds unwanted overhead.

  This mirrors the "abstraction for the common case, escape hatch for the hard case" trade-off from the ORM-vs-JDBC discussion in §13, just with a second, more fine-grained escape hatch (native SQL before native Hibernate) in between.

## 16. Interview questions

### 16.1 What's the difference between `persist()` and `merge()`, and when would using the wrong one bite you?
`persist()` only works on a new/transient entity and makes it managed in place (void return). `merge()` works on new, detached, or already-managed entities and always returns the instance to keep using; calling `merge()` on a detached entity does **not** make the argument you passed managed — only the returned instance is. The bite: calling `persist()` on an entity that already has a non-null ID the provider thinks indicates "existing" can throw; calling `merge()` and then continuing to mutate the *original* reference instead of the returned one silently does nothing.

### 16.2 Why would a `@OneToOne` relationship cause unexpected extra queries on a list of 1,000 entities?
Because `@OneToOne` (and `@ManyToOne`) default to `EAGER` fetching per the spec, unlike `@OneToMany`/`@ManyToMany` which default to `LAZY`. Loading 1,000 parents eagerly fetches each one's `@OneToOne` child, commonly one query per row unless the provider can batch-fetch or you use a fetch join/entity graph.

### 16.3 When would you choose `PESSIMISTIC_WRITE` over relying on `@Version` optimistic locking?
When the conflict is *expected and frequent enough* that letting it fail at commit and retrying is wasteful (e.g., high-contention counters/inventory decrement), or when the operation has external side effects that can't simply be rolled back and retried. Otherwise prefer optimistic locking — it scales better under low contention and doesn't hold a DB lock across business logic execution time.

### 16.4 What's the real risk of enabling the second-level cache on a frequently-updated entity with `READ_WRITE` concurrency strategy?
Correctness is still protected (soft locks prevent genuinely stale commits), but you add overhead for little benefit — every write invalidates/updates the cache entry, so a hot, frequently-written entity gets cache churn without the read-side payoff. L2 cache earns its keep on read-heavy, relatively static data (reference tables, rarely-changed configuration), not transactional hot rows.

### 16.5 Why does `orphanRemoval = true` sometimes delete rows you didn't expect?
Because it fires on **collection removal**, not just parent deletion. `parent.getChildren().remove(child)` alone — with no explicit `remove()` call on `child` or `parent` — is enough to delete that child's row at flush, if the collection is mapped `orphanRemoval = true`. Teams that only test the "delete the parent" path sometimes miss that "unlink a child" has the same destructive effect.

### 16.6 You're migrating a container-managed EJB app to Spring Boot. What's the closest Spring equivalent to an extended persistence context on a stateful session bean?
There's no exact match for stateless beans; Open EntityManager in View superficially resembles it (context stays open across the request) but solves a different problem (deferred lazy loading in the view layer) and carries its own risk (hides N+1 cost, holds a connection longer). The more idiomatic Spring answer is to redesign the conversational flow to not require entities to stay managed across calls — pass IDs/DTOs between steps and re-fetch/re-attach as needed per transaction, which is also generally better for horizontal scalability than a stateful bean pinned to one server.

### 16.7 Single-table vs joined vs table-per-class inheritance: which would you pick for a `Payment` hierarchy with `CardPayment`/`BankTransferPayment`/`WalletPayment` subtypes, and why?
Default to `SINGLE_TABLE` unless subclass-specific columns are numerous/mutually exclusive enough that nullable-column sprawl becomes a real schema-quality problem, or you need a DB-level NOT NULL constraint on a subclass-specific column (which `SINGLE_TABLE` can't express). `JOINED` normalizes that at the cost of join overhead on every polymorphic read. `TABLE_PER_CLASS` is rarely the right default — mainly for cases where you never need polymorphic queries across the hierarchy and want each payment type's table fully independent.

## Change references

- `javax.persistence` → `jakarta.persistence` namespace migration noted wherever the source notes used the older package name (§1, §14).
- Hibernate's native `Session.save()` flagged as deprecated/legacy rather than the modern equivalent of persisting an entity (§5; full comparison in [Spring-Data-Notes.md §4](../spring/Spring-Data-Notes.md#4-jpa-state-and-entitymanager)).
- `LockModeType.READ`/`WRITE` legacy names corrected to their current `OPTIMISTIC`/`OPTIMISTIC_FORCE_INCREMENT` equivalents (§7).
- "ORM removes the need to understand SQL" claim from the source notes softened to the actual trade-off (§13).

## Official references

- [Jakarta Persistence specification](https://jakarta.ee/specifications/persistence/)
- [Hibernate ORM User Guide](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html)
