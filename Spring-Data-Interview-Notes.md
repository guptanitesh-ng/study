# Spring Data and Data Access: Interview Notes

Reviewed: October 31, 2026. Source: the two-page Spring Data PDF, dated May 21, 2018.

The source is mostly Spring transaction management, ORM integration and JDBC, with only a short Spring Data JPA section. This editorial Markdown conversion retains those foundations, corrects misleading claims, and adds the repository/persistence/performance material missing from its title. It is not a verbatim transcript.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> [Boot](Spring-Boot-Interview-Notes.md) -> [REST + MVC](Spring-REST-MVC-Interview-Notes.md) -> **Data** -> [Security](Spring-Security-Interview-Notes.md).

## 1. Distinguish the layers

**Added foundation:**

- JDBC is SQL-oriented access through drivers and connections.
- JPA/Jakarta Persistence is an ORM specification; Hibernate is a provider.
- Spring ORM integrates resource management and transactions with persistence technologies.
- Spring Data is a family of store-specific repository abstractions, not another name for JPA or Hibernate.
- Spring Data JPA builds repositories over JPA; Spring Data JDBC has a different aggregate model and does not implement JPA's persistence context/lazy loading.
- R2DBC provides reactive relational access; a reactive API does not turn blocking JDBC into nonblocking I/O.

Pick a model based on domain complexity, SQL needs, performance and team understanding, not the smallest amount of boilerplate in a demo.

## 2. Transaction managers and boundaries

Local managers handle one transactional resource arrangement, such as `JdbcTransactionManager`/`DataSourceTransactionManager` for JDBC or `JpaTransactionManager` for JPA. `JtaTransactionManager` integrates JTA coordination across enlisted resources; distributed atomicity requires actual resource/coordinator support.

The PDF says every transaction manager creates an EntityManager and obtains a connection before the call. That describes one possible JPA arrangement, not the universal mechanism; connection acquisition can also be delayed.

For the usual imperative proxy-based setup, `@Transactional` installs method interception that asks the selected transaction manager to create/join a transaction, invokes the method, and completes or participates according to the outcome.

Place transaction boundaries around a coherent service-level unit of work. Multiple repository calls are not automatically one atomic operation unless they share the appropriate outer transaction.

New threads and ordinary asynchronous work do not inherit an imperative thread-bound transaction. Reactive transactions use Reactor context and a reactive manager. A database transaction does not encompass an HTTP call or an AI provider merely because both execute inside the method.

## 3. Rollback, propagation, isolation and read-only

Ordinary default rollback rules roll back on unchecked exceptions (`RuntimeException`) **and `Error`**, not on every checked exception. `rollbackFor`/`noRollbackFor` customize rules. Framework 6.2+ can configure an all-exceptions default, so always state the assumed policy.

| Propagation | Meaning |
|---|---|
| `REQUIRED` | Join the existing transaction or create one. Usual default. |
| `REQUIRES_NEW` | Independent physical transaction; suspend outer participation. |
| `NESTED` | With suitable manager/resource support, use savepoints within a physical transaction. |
| `SUPPORTS` | Participate if one exists; otherwise run without one. The PDF's `SUPPORTED` spelling is wrong. |
| `MANDATORY` | Require an existing transaction. |
| `NOT_SUPPORTED` | Suspend transaction participation. |
| `NEVER` | Reject an existing transaction. |

**High-value traps:**

- Self-invocation bypasses ordinary transaction proxies; see [Core AOP](Spring-Core-Interview-Notes.md).
- Catching an exception is not guaranteed to clear a rollback-only marker. An inner `REQUIRED` scope can cause `UnexpectedRollbackException` when the outer caller tries to commit.
- `REQUIRES_NEW` may need another connection while the outer transaction holds one. Size pools and concurrency accordingly.
- `NESTED` is not a portable substitute for `REQUIRES_NEW`. Savepoint rollback depends on the manager; do not assume arbitrary JPA entity state is restored. An exception is not magically swallowed so the caller can continue.
- Isolation, timeout and read-only settings on an inner participating scope generally do not replace the outer transaction's settings.

`readOnly=true` is a hint that managers/providers can use for optimization; it is not a universal prohibition on writes. Isolation support depends on the manager, provider and resource; the PDF's universal claim about JTA isolation is too strong.

Understand dirty reads, non-repeatable reads, phantoms and lost updates. Isolation does not eliminate the need for locking or constraints appropriate to the invariant.

## 4. JPA state and EntityManager

**Added:**

| Entity state | Useful mental model |
|---|---|
| New/transient | Not yet managed/persisted. |
| Managed | Tracked in a persistence context; changes can be detected at flush. |
| Detached | No longer tracked by that persistence context. |
| Removed | Marked for deletion within a context. |

`persist` makes a new entity managed; `merge` copies state into a managed instance and returns that instance. `flush` synchronizes pending changes with the database; it is **not** commit. SQL can run before transaction completion.

`@PersistenceContext` commonly injects a shared proxy routing to an appropriate EntityManager. The actual EntityManager and its managed entities are not made safe for arbitrary concurrent use. The PDF's "always thread-safe" conclusion is incorrect.

`@PersistenceContext` and `@PersistenceUnit` are Jakarta Persistence annotations, not Spring annotations. Framework 7 / JPA 3.2 add broader injection options, but do not blindly replace established patterns without matching the stack.

Native Hibernate contextual-session integration remains an option. Old HibernateTemplate recipes are not the preferred general JPA approach; Hibernate-specific configuration/classes vary by framework generation.

### Which API: `persist`, `merge`, or `save`?

`EntityManager` has **no `save()` method**. Distinguish the standard JPA operations from Spring Data's repository method and legacy native Hibernate APIs:

| API | Purpose and return value | What happens to the supplied instance? |
| --- | --- | --- |
| `EntityManager.persist(newEntity)` | Make a new entity managed; returns `void` | That instance becomes managed; persistence is synchronized through flush |
| `EntityManager.merge(entity)` | Copy new/detached state into a managed instance; returns the managed instance | A detached input stays detached; use the returned instance for further tracked changes |
| Spring Data JPA `repository.save(entity)` | Select persist or merge using entity-new detection; returns an entity | Persist path returns the supplied instance; merge path returns the managed result |
| Legacy Hibernate `Session.save(entity)` | Native operation for transient entities, returning an identifier in older Hibernate versions | Historically makes the supplied transient instance persistent; not the modern portable JPA API |

Hibernate deprecated native `save()` in 6.x and removed it in 7; recognize it in older code, not as the recommended modern equivalent of repository `save()`. Modern JPA imports use `jakarta.persistence`, not older `javax.persistence` packages.

Neither an identifier nor the return from any of these operations proves commit. SQL timing depends on identifier generation, flush mode, pending changes and provider behavior. **Merge is not a guaranteed SELECT-then-UPDATE sequence or a database upsert.** It may reuse a managed instance already in the persistence context, load state when needed, or persist a genuinely new entity. Do not assume a missing detached row is inserted: Hibernate 6.6+ reports an optimistic-lock failure when it can identify the entity as definitely detached (for example, through a generated ID or a non-primitive version).

**What if the entity is already managed?** JPA ignores the merge operation for that entity's own state and returns the managed instance; merge can still cascade to relationships configured with `MERGE` or `ALL`. Do not describe this as a mandatory copy onto itself or promise zero SQL across the whole graph. In an ordinary writable transaction, changing the managed entity is enough for dirty checking; an extra `merge()` or repository `save()` is not needed just to persist those changes.

## 5. Spring Data repositories

`JpaRepository<Entity, ID>` supplies JPA-specific repository functionality. Do not memorize the PDF's "18 inherited methods"; interfaces and inheritance have changed over releases.

Repository infrastructure creates proxies backed by implementations and query machinery. The source correctly describes conventional runtime repository creation, but its absolute "never build-time generation" statement should not be extended to all modern AOT arrangements.

Repositories can be discovered through Boot auto-configuration or explicit `@EnableJpaRepositories`; `<jpa:repositories>` is legacy XML recognition material.

**Added essential concepts:**

- Derived query methods, `@Query` JPQL, native SQL, parameter binding and query validation.
- Projections/DTOs, Specifications or another query-composition approach where appropriate.
- Custom repository fragments for queries/operations that do not fit a derived method.
- `Page` versus `Slice`: `Page` exposes totals and commonly requires a count query; `Slice` reports whether more data exists without requiring totals. See the practical comparison below.
- Stable sorting and bounded pagination; consider keyset scrolling for large datasets when supported.
- `save` chooses persist or merge based on entity-new detection, not "always insert" or "always immediately execute SQL". Use its return value, especially when merge is involved.
- Bulk update/delete can bypass entity lifecycle/dirty checking and leave managed state stale; consider flush/clear strategy and transaction boundaries.

Inherited CRUD methods have default transaction settings in the JPA implementation. Declared query methods do not all inherit transactional configuration by default. The outer service transaction governs participating operations; do not assume every repository annotation starts a separate transaction.

### `Page` versus `Slice`: totals or just "load more"?

These are Spring Data result abstractions, not JPA specification types. `Pageable` supplies the requested page, size and sorting; the repository return type determines which result metadata is needed.

| Question | `Page<T>` | `Slice<T>` |
| --- | --- | --- |
| What does the caller know? | Content, current page, whether more exists, total elements and total pages | Content, current slice and whether more exists; no totals contract |
| Typical paged query work | Data query plus a count query when needed | Data query fetching up to `size + 1` rows to detect another slice |
| Useful methods | `getContent()`, `getNumber()`, `hasNext()`, `hasPrevious()`, `getTotalElements()`, `getTotalPages()` | `getContent()`, `getNumber()`, `hasNext()`, `hasPrevious()`; no `getTotalElements()` or `getTotalPages()` |
| Typical UI | "247 results, page 1 of 25" | Infinite scroll or a "Load more" button |
| Main trade-off | Totals can add significant database work | Avoids the total count, but does not remove other query costs |

`Page` extends `Slice`, adding totals. A `Page` does **not always mean exactly two SQL statements**: Spring Data can skip the count when it can infer the total from an incomplete result page. Lazy association loading can also add queries for either result type.

**Repository example:** assume the existing `PurchaseOrder` entity has a String `status` and a unique `id`. The method names differ so both signatures can coexist; Java cannot overload a method by return type alone.

```java
Page<PurchaseOrder> findPageByStatus(String status, Pageable pageable);

Slice<PurchaseOrder> findSliceByStatus(String status, Pageable pageable);
```

```java
Pageable request = PageRequest.of(0, 10, Sort.by("id").ascending());
Page<PurchaseOrder> page = orders.findPageByStatus("OPEN", request);
Slice<PurchaseOrder> slice = orders.findSliceByStatus("OPEN", request);
```

The calls above illustrate alternatives; a real endpoint normally chooses one, not both. Page numbering starts at zero. With page size 10, representative SQL is:

```sql
-- Page: requested rows, plus a separate count when needed.
SELECT * FROM purchase_order
WHERE status = 'OPEN' ORDER BY id LIMIT 10 OFFSET 0;
SELECT COUNT(*) FROM purchase_order WHERE status = 'OPEN';

-- Slice alternative: look ahead by one row; no total-count query required.
SELECT * FROM purchase_order
WHERE status = 'OPEN' ORDER BY id LIMIT 11 OFFSET 0;
```

Actual SQL syntax depends on the database/dialect. If the slice query returns 11 rows, Spring Data returns the first 10 and sets `hasNext()` to true. If it returns 10 or fewer, `hasNext()` is false. The look-ahead row is not exposed as an extra result.

**Performance reasoning:** an expensive count can dominate a filtered or joined query, so removing it can help. Do not promise that `Slice` is always faster or that `COUNT(*)` always scans the whole table; filters, indexes, query plans and database behavior matter. Complex page queries may require an explicit `countQuery` that counts the intended entities, not multiplied join rows.

**Interviewer follow-up: "Will `Slice` fix slow page 10,000?"** Not by itself. A `PageRequest`-based slice still uses an offset; deep offsets can remain expensive. Use stable ordering with a unique tie-breaker, bound page sizes, and consider keyset scrolling/cursors for sequential traversal. Concurrent inserts/deletes can still shift offset-based results; neither result type promises a frozen snapshot or an atomic match between count and content.

## 6. Persistence performance and correctness

**Added, high priority for experienced interviews:**

- Explain N+1 queries and verify actual SQL/query counts. Use projections, fetch joins, entity graphs or batching deliberately; making everything eager is not a universal fix.
- Understand `LazyInitializationException`; Open EntityManager in View can allow access later but may hide query cost. Prefer deliberate loading and DTO boundaries.
- Be careful paginating collection fetch joins; logical entity pages and SQL row pages can differ.
- `@Version` supports optimistic locking; pessimistic locks have contention/deadlock trade-offs. Use database constraints for uniqueness/invariants.
- Know relationship ownership, cascades and orphan removal; cascade is not authorization or permission to delete shared entities.
- Size connection pools, keep transactions short, inspect indexes/query plans, and distinguish first-level persistence-context caching from optional second-level caches.
- Test concurrent updates and migrations; an ORM abstraction does not remove database-specific behavior.

## 7. Exception handling with Spring Data JPA and Hibernate

**Recall:** Hibernate performs persistence; Spring translates supported persistence failures and manages transactions; application code decides recovery; REST advice decides the HTTP response. These are separate responsibilities.

Use the Spring Data JPA + Hibernate stack for these examples. The underlying JPA concepts remain persistence context, flush, commit, entity state and locking; learning Spring does not require relearning those concepts as repository method names.

### Where the failure crosses a boundary

```text
REST controller
    -> transactional service proxy begins/joins transaction
        -> service invokes Spring Data repository proxy
            -> JPA EntityManager -> Hibernate -> JDBC/database
        <- repository may translate a failure into DataAccessException
    <- service transaction completes; flush/commit can also fail here
<- exception reaches caller / MVC exception advice
```

This is not a mandatory chain for every exception. Repository integration translates supported exceptions crossing its boundary. `JpaTransactionManager` and its JPA dialect also handle supported transaction-completion failures. Other failures can surface as transaction exceptions or provider exceptions depending on their origin and configuration.

`DataAccessException` is an unchecked Spring hierarchy with the underlying cause retained. It reduces application coupling to provider/JDBC exception types; it does not make every failure retryable or classify every database constraint as a business conflict.

### Recognize categories, not just class names

| Failure | Typical Spring-facing category | Application decision |
| --- | --- | --- |
| Unique, foreign-key or not-null constraint failure | `DataIntegrityViolationException` | Identify the known constraint/invariant; unexpected violations may be defects |
| Stale version / optimistic update failure | `OptimisticLockingFailureException`, often a more specific JPA subclass | Report conflict or rerun a safe operation using fresh state |
| Lock acquisition / pessimistic locking failure | `CannotAcquireLockException` / `PessimisticLockingFailureException` | Consider bounded whole-transaction retry after examining the cause |
| Connectivity/resource failure | A resource-failure or transaction-creation exception | Distinguish inability to start from an unknown commit outcome |
| Invalid persistence API use | `InvalidDataAccessApiUsageException` for supported translations | Fix the programming/configuration error, not blind retry |
| Unexpected rollback of a participating transaction | `UnexpectedRollbackException` | Find the earlier rollback-only cause; catching did not repair the transaction |

Exact types depend on the Hibernate version, dialect, driver and stage of failure. For example, do not depend on every JPA duplicate-key violation becoming the JDBC-oriented `DuplicateKeyException`; `DataIntegrityViolationException` is commonly the useful broader category.

Hibernate lazy-loading failures are a fetch/context-lifetime issue, not normally a bad HTTP request. Serialization may trigger them outside a repository boundary, so they need not arrive as a translated repository exception.

### Sample: catch outside the transaction that can fail

Assume `PurchaseOrder` is a mapped entity, `OrderRepository` extends `JpaRepository<PurchaseOrder, Long>`, and the database enforces a named unique constraint for the merchant checkout reference. These are illustrative separate classes in the scanned package; imports and domain implementations are omitted.

```java
@Service
public class OrderWriter {
    private final OrderRepository orders;

    public OrderWriter(OrderRepository orders) {
        this.orders = orders;
    }

    @Transactional
    public Long create(CreateOrder command) {
        PurchaseOrder order = orders.save(PurchaseOrder.from(command));
        return order.getId();
    }
}
```

```java
@Service
public class OrderApplication {
    private final OrderWriter writer;

    public OrderApplication(OrderWriter writer) {
        this.writer = writer;
    }

    public Long create(CreateOrder command) {
        try {
            return writer.create(command);
        } catch (DataIntegrityViolationException failure) {
            throw new OrderPersistenceRejectedException(
                    "Order could not be persisted", failure);
        }
    }
}
```

`OrderPersistenceRejectedException` is an application `RuntimeException` with a `(String, Throwable)` constructor, preserving the original cause. It is not automatically an HTTP 409.

**Why two beans?** In this example `OrderApplication` has no surrounding transaction; its call goes through another bean's transaction proxy. The `try/catch` surrounds both method execution and transaction completion. A `try/catch` inside `OrderWriter.create()` around `save()` alone can miss an error raised when its proxy commits after the method returns.

This wrapper illustrates timing, not a requirement to wrap every Spring exception. Only translate when your layer adds meaningful semantics. A recognized checkout uniqueness constraint can become `OrderConflictException`; a missing required column or unrelated foreign-key failure must not be relabelled as that conflict. Classify using supported constraint/cause metadata for the chosen stack, not brittle parsing of human-readable SQL messages.

If an outer caller already has a transaction, `REQUIRED` joins it and completion moves to that outer boundary. The catch above then does not surround the final commit. Draw the actual transaction boundary before deciding where to handle failures.

### Flush, rollback and retry

`saveAndFlush()` can expose failures earlier, but **flush is not commit**. Deferred constraints and transaction completion can still fail later. Flushing also changes SQL timing/batching; do not add it everywhere just to make exceptions easier to catch.

After a Hibernate persistence failure, roll back and discard the failed persistence context rather than attempting to repair it with `clear()` or continuing more queries. A rollback-only transaction can produce `UnexpectedRollbackException` even if an earlier exception was caught.

Retry a genuinely retryable operation **around a fresh transaction**, not repeatedly inside the failed one. Re-read state and repeat the complete unit of work. Bound attempts/time, add backoff where appropriate, and exclude non-idempotent external effects. Losing a connection during commit can leave an unknown outcome; a retry then needs operation identity/reconciliation, not just a transient-exception catch.

### From persistence failure to REST response

For a recognized business conflict, an application exception can propagate to shared REST advice:

```java
@RestControllerAdvice
public class OrderErrors {
    @ExceptionHandler(OrderConflictException.class)
    public ResponseEntity<ProblemDetail> conflict(OrderConflictException failure) {
        ProblemDetail body = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "The order conflicts with existing state.");
        body.setProperty("code", "ORDER_CONFLICT");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }
}
```

This is Spring Framework 6+ response handling, not transaction management. A generic integrity failure is not automatically mapped by this handler. Preserve technical causes in protected diagnostics, return safe details, and avoid logging the same failure at every layer.

### JDBC supporting context

`JdbcTemplate` manages JDBC resources and repetitive execution/error handling while application code supplies SQL, parameters and row mapping. A configured shared template can be used concurrently; application callbacks and mutable state still need care.

`NamedParameterJdbcTemplate` supports named parameters and delegates to JDBC template infrastructure. `RowMapper` maps a row to an object; `RowCallbackHandler` processes rows; statement creators provide custom statement construction.

**Correction:** `SimpleJdbcTemplate` and corresponding SimpleJdbc support recipes are obsolete. Modern options include `JdbcTemplate`, `NamedParameterJdbcTemplate`, and Framework 6.1+ `JdbcClient` for a fluent common-query/update API.

Prefer composition/injection over subclassing `JdbcDaoSupport` just to access a template. Bind query values instead of concatenating untrusted strings; allowlist dynamic identifiers/sort choices separately.

Spring translates technology-specific failures into the `DataAccessException` hierarchy while retaining causes. Translation does not mean every exception is nonrecoverable or safe to retry: distinguish transient connectivity/deadlock failures from constraint or programming errors.

`@Repository` makes a class eligible for configured persistence-exception translation; it is not, by itself, a guarantee of translation for arbitrary code. Templates and repository infrastructure provide their own integration.

## 8. Embedded databases and tests

Embedded databases are useful for fast development/tests, but supported engines differ by framework generation. The PDF's H2/HSQL/Derby list is not a timeless compatibility statement.

**Added:** an embedded database does not prove production dialect, collation, locking or migration correctness. Use the production engine in Testcontainers for those behaviors. Combine focused repository tests, query-count/performance checks, real migration tests and concurrent transaction cases.

Default test rollback can mask flush/commit-time errors. Explicitly exercise the lifecycle stage relevant to the assertion. A mocked repository cannot verify SQL, isolation or locking behavior.

## 9. 2026 and AI-age considerations

Know Jakarta package migration, current provider compatibility and AOT constraints; prioritize persistence semantics over version trivia.

For AI/RAG applications, vector storage is not simply another JPA query. Study ingestion/chunking, embedding versioning, tenant/document ACLs, metadata filters, deletion propagation and retrieval quality when the role expects it. Apply authorization before retrieved data reaches a model.

Do not hold a database transaction open while waiting for a long model call. Persist intent/results with deliberate boundaries; for cross-system side effects, consider an outbox/idempotency design rather than claiming local `@Transactional` makes everything atomic.

AI-generated repository methods must still be reviewed for query semantics, parameter safety, fetch plans, authorization scope and pagination limits.

## 10. Interview questions: Spring Data JPA + Hibernate

Answer from persistence semantics and failure boundaries, not annotation recall. Samples omit imports, entity mappings and unrelated domain code; they illustrate the stated Spring proxy-based transaction arrangement, not an application executed in this repository.

### 10.1 What does Spring Data add to a JPA application?

**Answer:** repository proxies, common CRUD implementations and query machinery over JPA. Hibernate remains the ORM provider; Spring ORM/transaction infrastructure integrates resource lifecycle and exception translation. Database constraints and JPA persistence-context semantics still apply.

**Scenario:** a derived repository query removes handwritten DAO code, but its association traversal can still cause N+1 queries. Less boilerplate is not a new consistency model or automatic performance guarantee.

**Sample:** Spring supplies this repository's implementation; Hibernate executes the JPA work underneath it.

```java
public interface OrderRepository extends JpaRepository<PurchaseOrder, Long> {
    List<PurchaseOrder> findByStatus(OrderStatus status);
}
```

Across the following independent snippets, assume mapped domain types, injected collaborators and application exceptions with the indicated constructors. Methods annotated `@Transactional` are called through a Spring proxy, not self-invoked. `entityManager` denotes an injected `@PersistenceContext` EntityManager. These are reference fragments, not one copy-paste application.

### 10.2 Two repository writes must succeed together. Where is the boundary?

**Answer:** put one coherent service operation under an outer transaction. Repository-local transactions alone do not make separately invoked writes atomic.

```java
@Transactional
public void transferStock(Long source, Long target, int quantity) {
    Stock from = stocks.findById(source).orElseThrow(StockNotFoundException::new);
    Stock to = stocks.findById(target).orElseThrow(StockNotFoundException::new);
    from.remove(quantity);
    to.add(quantity);
}
```

**Scenario:** both entities are managed in this transaction; dirty checking persists changes without mandatory extra `save()` calls. An unchecked failure rolls back under ordinary defaults. Concurrent transfers still need suitable locking/invariant protection; the transaction annotation alone does not prevent lost updates.

### 10.3 `save()` returned successfully. Is the order safely stored?

**Answer:** not necessarily. SQL may run immediately or be deferred until flush; commit happens at the enclosing transaction boundary. Even a generated ID does not prove commit succeeded.

**Scenario:** Hibernate queues an INSERT; a uniqueness violation appears at commit after the service method body returns. Catch around the transactional proxy call, as in section 7, rather than assuming a catch around `save()` sees everything.

**Example timing:**

```text
Caller -> transaction proxy -> writer.create()
                                  -> save() returns
                                  -> method returns
                            -> flush/commit fails
Caller receives exception, not the method's successful return value.
```

For code, reuse section 7's `OrderApplication -> OrderWriter` sample: the non-transactional caller surrounds the transaction proxy invocation with its catch.

### 10.4 `save()` returns another instance. Why?

**Answer:** Spring Data's new-entity detection selects persist versus merge. Merge copies state into a managed instance and returns it; the supplied detached instance is not made managed by that operation.

**Scenario:** use `PurchaseOrder managed = orders.save(detached);` and reason about which instance is tracked. Do not equate merge with a partial HTTP patch; copying stale or omitted fields can overwrite state. Prefer loading the managed entity and applying explicitly allowed changes.

**Sample:** for an existing detached entity, merge returns the tracked copy.

```java
@Transactional
public void changeNote(PurchaseOrder detached) {
    PurchaseOrder managed = orders.save(detached);
    managed.setNote("Tracked change");
    // A later change to detached is not automatically tracked.
}
```

Here the supplied entity is detached and repository new-detection identifies it as existing. This is merge behavior, not a claim that every `save()` returns a different instance.

**Follow-up: "What if I fetched the entity in this same transaction?"**

```java
@Transactional
public void changeNote(Long orderId, String note) {
    PurchaseOrder managed = orders.findById(orderId).orElseThrow();
    managed.setNote(note);
}
```

In the ordinary writable transaction shown here, the loaded entity is managed and dirty checking synchronizes the change at flush; no extra `save()` or `merge()` is required. After the persistence context ends, the object is no longer tracked by that context. Changing it later does not automatically update the database.

**Follow-up: "What happens to database fields I did not populate in a detached object?"** Merge is state copying, **not partial-update intent**. If an ordinary loaded/copied attribute contains `null`, `0` or `false`, that value can replace the managed value and be written at flush. A database constraint may reject it instead, rolling back rather than silently accepting the overwrite.

```text
Database row:       id=42, note="Leave at reception", status="OPEN"
Sparse input:       id=42, note="Call on arrival",    status=null
After naive merge:  managed note="Call on arrival", managed status=null
Flush:              status may be overwritten, or a NOT NULL constraint fails
```

An object newly constructed from a request with an ID is not necessarily a genuinely detached entity; entity-new detection and version mappings still matter. The risk remains: omitted request fields represented by defaults can be mistaken for state to persist. JPA requires unfetched lazy attributes to be ignored during merge; that is different from an ordinary field left `null` while constructing a sparse request object.

**Safer application pattern: load, authorize, apply allowed changes.** Use a request DTO describing the operation rather than binding incoming JSON directly onto an entity. For a note-only endpoint, assume `NoteChange` has a `String note()` accessor, `null` deliberately clears the note, and the authorization component checks the current caller:

```java
@Transactional
public void updateNote(Long orderId, NoteChange command) {
    PurchaseOrder managed = orders.findById(orderId).orElseThrow();
    orderAccess.requireCanEdit(managed);
    managed.setNote(command.note());
}
```

This operation changes only the note; it never maps request defaults onto status or other fields. Validate input and enforce business invariants before changing state. For a multi-field PATCH, represent **absent**, **present with null**, and **present with a value** separately when clearing is allowed. A blanket "copy only non-null fields" rule cannot distinguish omission from an intentional clear. Generic property copying also risks changing fields the caller must not control.

| Proposed fix | What it actually guarantees |
| --- | --- |
| Load the managed entity, apply an allowlisted DTO | Preserves fields outside the operation; explicit presence semantics can support deliberate clears |
| Hibernate `@DynamicUpdate` | Can restrict UPDATE columns to detected changes; it does not stop a merged `null` being detected as a change |
| `@Column(updatable = false)` | Excludes that column from provider-generated updates for the mapping; it is not authorization or protection against native SQL/other writers, and the managed value can still differ from the database |
| `@Version` | Detects conflicting versioned writes; it does not distinguish an omitted field from an intentional value |

**Interviewer follow-up: "Does loading first solve stale client updates?"** Not by itself. `@Version` protects concurrent writes after the load, but an old client can still overwrite a value if the server loads the latest version and applies that stale request unconditionally. When the contract requires rejecting stale edits, carry and check an expected version/ETag as well as retaining database optimistic locking.

### 10.5 Flush succeeded. Can a later failure still undo the writes?

**Answer:** yes. Flush synchronizes SQL inside the transaction; it does not complete the transaction. A later rollback can undo transactional writes, although sequence allocation and external effects are not necessarily reversible.

**Scenario:** `saveAndFlush()` succeeds, then another invariant fails with an unchecked exception. The transaction rolls back. A test asserting SQL execution or an assigned ID is not a test of committed state.

**Sample:** an intentional failure after SQL has executed.

```java
@Transactional
public void demonstrateRollback(CreateOrder command) {
    orders.saveAndFlush(PurchaseOrder.from(command));
    throw new IllegalStateException("Demonstration: abort after flush");
}
```

After the proxy rolls back, query from a new transaction to verify that this order was not committed. This deliberately failing method is a teaching example, not production business logic.

### 10.6 Does exception translation mean every failure becomes the same exception?

**Answer:** no. Spring maps supported failures into categories while retaining the cause. The actual boundary matters: repository invocation and transaction completion have different integration paths; a serialization-time lazy failure is elsewhere.

**Scenario:** a unique constraint commonly yields `DataIntegrityViolationException`, while a stale version can yield an optimistic-locking category. A handler matching one provider exception only may miss the translated exception; a catch for every `DataAccessException` that returns 409 misclassifies outages and programming errors.

**Sample:** a custom JPA DAO can participate in configured translation too; it does not have to extend a Spring Data interface.

```java
@Repository
public class OrderDao {
    @PersistenceContext
    private EntityManager entityManager;

    public void insertAndFlush(PurchaseOrder order) {
        entityManager.persist(order);
        entityManager.flush();
    }
}
```

With persistence-exception translation infrastructure configured (normally supplied in the Boot JPA setup), a supported provider failure escaping this proxied repository can be translated. The caller must supply the transaction. `@Repository` alone does not install all that infrastructure.

### 10.7 Should every integrity violation return HTTP 409?

**Answer:** no. Map a known invariant to a deliberate application contract; diagnose unknown violations as possible defects. Do not expose SQL, constraint internals or another user's record through error details.

**Scenario:** duplicate merchant checkout reference can mean conflict or replay of an idempotent request. A not-null violation caused by a broken server mapping is not the same business condition. Database constraints enforce correctness under concurrency even if a friendly precheck exists.

**Example database invariant:**

```sql
ALTER TABLE purchase_order
ADD CONSTRAINT uk_order_merchant_checkout
UNIQUE (merchant_id, checkout_reference);
```

Assume both columns are required/non-null in the schema. Only a recognized violation of this constraint should enter the duplicate-checkout policy. Unrelated constraints remain different failures. Constraint-name extraction is provider-specific; do not assume `failure.getMessage().contains(...)` is a reliable classifier.

### 10.8 What happens if I catch a runtime exception inside a JPA transaction?

**Answer:** catching changes Java control flow; it does not reset transaction state. Ask **which transactional proxy saw the exception** and **whether Spring, the provider or the database already made the transaction rollback-only**. Under ordinary proxy-based rollback rules:

| Where the failure occurs | What the catch does not tell you | Likely outcome |
| --- | --- | --- |
| Local business code throws and the same method catches it before any transactional interceptor sees it | No rollback decision has necessarily been made | Earlier valid writes can commit if the transaction remains healthy and completion succeeds |
| A separate bean's inner `REQUIRED` method throws a runtime exception through its transaction proxy, then the outer method catches it | The inner proxy has already applied its rollback rule to the shared transaction | Outer completion rolls back and normally raises `UnexpectedRollbackException` |
| A constraint/flush failure occurs in Hibernate or the database, then application code catches it | The transaction and persistence context may already be unusable; a transactional repository proxy can also mark rollback-only | Roll back; attempted completion may report `UnexpectedRollbackException` or another transaction/provider failure |

**Case 1: a caught local business exception can still allow commit.** Assume `ShippingOptionUnavailableException` is an application `RuntimeException`, and `shippingOptions.choose()` is a local helper with no transactional proxy or persistence access.

```java
@Transactional
public void chooseShipping(Long orderId, String requestedOption) {
    PurchaseOrder order = orders.findById(orderId).orElseThrow();
    try {
        order.setShippingOption(shippingOptions.choose(requestedOption));
    } catch (ShippingOptionUnavailableException failure) {
        log.info("Requested shipping unavailable; applying standard shipping");
        order.setShippingOption("STANDARD");
    }
}
```

Here the catch implements a deliberate supported fallback. If no other failure occurs, dirty checking can persist `STANDARD` at completion. The outer transaction interceptor sees a normal return, not the caught exception. This is not a reason to catch arbitrary runtime exceptions: doing so can commit partial work that the caller expected to roll back.

**Case 2: why does commit fail after I caught the inner exception?** These methods belong to separate Spring beans, so the call crosses the inner proxy:

```java
// InnerWork
@Transactional
public void run() {
    throw new IllegalStateException("Inner operation failed");
}
```

```java
// OuterWork: innerWork is an injected InnerWork proxy.
@Transactional
public void run() {
    try {
        innerWork.run();
    } catch (IllegalStateException failure) {
        log.warn("Inner failure caught; shared transaction is still doomed", failure);
    }
}
```

Under the ordinary `REQUIRED`/rollback policy, the inner proxy marks the shared transaction rollback-only. The outer proxy then fails completion with `UnexpectedRollbackException`. This catch is intentionally an anti-pattern demonstration, not successful recovery.

```text
Caller -> outer proxy starts transaction T
           -> outer method calls inner proxy; REQUIRED joins T
                -> inner method throws IllegalStateException
                <- inner proxy marks T rollback-only and rethrows
           <- outer method catches it and returns normally
        <- outer proxy tries to commit T, rolls back instead
Caller receives UnexpectedRollbackException
```

**Follow-up: "What if I call `this.innerMethod()`?"** Ordinary self-invocation bypasses the inner transaction proxy. For a purely local exception caught by the outer method, the inner annotation alone therefore does not mark rollback-only. A real provider/database failure can still invalidate the transaction independently; bypassing the proxy is not a recovery strategy.

**Case 3: a caught persistence failure is not repaired.** For example, `saveAndFlush()` encounters a unique-constraint violation; the service catches it and tries to write an audit row using the same transaction. Both writes now participate in a transaction that may already be doomed, and the audit is not independently durable. Find the **first** failure rather than treating the later `UnexpectedRollbackException` as the root cause. Section 7 explains why catching around `save()` may also miss a failure deferred until commit.

Do not memorize "every JPA exception marks rollback-only." JPA distinguishes exceptions: for example, `QueryTimeoutException` describes a statement-only rollback that does not itself mark the transaction rollback-only. But if that unchecked exception crosses a participating Spring transaction interceptor, Spring's rollback rule can still mark the shared transaction. Database-specific behavior and timeout types matter; a generic statement that every timeout either permits continuation or dooms the transaction is unsafe.

**Choose handling based on the business outcome:**

| Intended outcome | Practical handling |
| --- | --- |
| All writes must fail together | Let the exception propagate, or rethrow a meaningful runtime exception with its cause. For a checked wrapper, configure the rollback rule explicitly. |
| Handle the error inside the method but discard its writes | Explicitly call `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()` within the active Spring-managed transactional method. Return an explicit failure outcome, not a success response. |
| Optional work must fail independently | Call a separate proxied bean using `@Transactional(propagation = Propagation.REQUIRES_NEW)` and catch its failure outside that inner boundary. It rolls back independently; it is not a nested/savepoint transaction. |
| Persist a failure audit after the main write fails | Prefer catching outside the completed failed transaction, then invoke a separate transactional audit writer. If an outer transaction still exists, use a deliberately independent boundary and define what happens if auditing fails too. |

**Important limits:** marking the owning scope rollback-only explicitly usually causes an intentional rollback without `UnexpectedRollbackException`; an enclosing scope unaware of a participating scope's rollback-only decision can still receive it. `noRollbackFor` changes Spring's exception-based policy, not a provider/database rollback-only marker. `REQUIRES_NEW` cannot repair the outer transaction, may need an additional connection, and can contend with locks held by the suspended transaction. Its committed data survives a later outer rollback, so reserve it for genuinely independent work.

### 10.9 How do you retry a deadlock or optimistic-lock conflict safely?

**Answer:** first decide whether rerunning the business operation is valid. Retry the whole unit of work with a new transaction and fresh state, not just the failed SQL or the same managed objects. A user edit conflict may need user reconciliation rather than automatic overwrite.

```java
// OrderApplication is non-transactional; writer is a separate proxied bean.
public void reserve(ReserveCommand command) {
    for (int attempt = 1; attempt <= 2; attempt++) {
        try {
            writer.reserve(command);
            return;
        } catch (OptimisticLockingFailureException failure) {
            if (attempt == 2) {
                throw failure;
            }
        }
    }
}
```

**Scenario:** `writer.reserve()` is transactional, loads current stock and rechecks availability every attempt; it has no remote side effects. The first call has completed rollback before retry begins. This minimal bounded sample omits production backoff/telemetry; it assumes no caller transaction. A broad retry on all data-access failures would include nonretryable constraints and potentially unknown commit outcomes.

### 10.10 What exactly does optimistic locking protect?

**Answer:** a mapped version lets the provider detect conflicting updates instead of silently overwriting another transaction's work. It does not enforce every cross-row invariant, and bulk operations must deliberately preserve equivalent concurrency checks.

**Scenario:** two requests load version 7; the first commits version 8, the second fails its version check. Report conflict or rerun a safe intent using fresh state. Do not simply copy the old user snapshot over version 8 and call that recovery.

**Sample entity fragment and concurrent timeline:**

```java
@Version
private Long version;
```

```text
Transaction A reads order 123 at version 7.
Transaction B reads order 123 at version 7.
A changes status and commits -> database version 8.
B changes status and flushes -> version 7 no longer matches.
```

Conceptually, B attempts:

```sql
UPDATE purchase_order
SET status = ?, version = 8
WHERE id = 123 AND version = 7;
```

Zero matching rows signal stale state in this versioned-update example. This is the category you may remember as OpenJPA optimistic verification failure; Hibernate/JPA and Spring expose their corresponding exception categories. **Multiple changes to the same managed entity within one transaction are normal**, not automatically a version conflict.

### 10.11 When would you use pessimistic locking instead?

**Answer:** when deliberate contention control is worth blocking and locks fit the database access pattern. Keep transactions short, use consistent lock order, and plan for timeouts/deadlocks. A pessimistic lock is not permission to hold a transaction during a slow network call.

**Scenario:** reserve scarce stock under high contention. Compare an atomic conditional update, optimistic versioning and a row lock based on measured conflicts. If the atomic update affects zero rows, distinguish insufficient stock/missing resource according to the contract.

**Sample:** repository lock plus a service transaction that owns its duration.

```java
public interface StockRepository extends JpaRepository<Stock, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Stock s where s.id = :id")
    Optional<Stock> findForUpdate(@Param("id") Long id);
}
```

```java
@Transactional
public void reserve(Long stockId, int quantity) {
    if (quantity <= 0) {
        throw new IllegalArgumentException("Quantity must be positive");
    }
    Stock stock = stocks.findForUpdate(stockId)
            .orElseThrow(StockNotFoundException::new);
    stock.reserve(quantity);
}
```

`Stock.reserve()` enforces available quantity. The database lock is normally held until transaction completion, not just until the repository method returns. Lock timeout support and behavior depend on the database/provider.

### 10.12 Why does a REST response trigger a lazy-loading exception?

**Answer:** the serializer traverses an unloaded association after the relevant persistence context has closed. The issue is the loading/DTO boundary, not the frontend's JSON or a missing exception annotation.

**Scenario:** return a DTO assembled from an intentional fetch plan inside the service transaction. Open EntityManager in View may allow late queries but can hide N+1 costs. Disabling laziness everywhere replaces one problem with overfetching and does not define a clean API.

**Sample:** initialize only what the DTO needs while the context is active.

```java
public record OrderDetails(Long id, String customerName) { }
```

```java
@Transactional(readOnly = true)
public OrderDetails details(Long id) {
    PurchaseOrder order = orders.findById(id)
            .orElseThrow(OrderNotFoundException::new);
    return new OrderDetails(order.getId(), order.getCustomer().getName());
}
```

The customer access may issue another query here, but it happens within the transaction. Returning this scalar DTO avoids later lazy traversal by Jackson. For a list, use an intentional bulk fetch/projection rather than repeating this access per row.

### 10.13 How do you diagnose an endpoint issuing hundreds of queries?

**Answer:** inspect SQL/query counts and association access, then choose projections, fetch joins, entity graphs or batching for that use case. Test pagination and result correctness, not just the absence of exceptions.

**Scenario:** an order list reads each customer's name and every line item. Avoid blindly fetching multiple collections or paginating collection joins; SQL row multiplication can distort paging and memory usage. A dedicated list DTO query may be the simplest solution.

**Sample:** a bounded DTO query for a list screen; use a fully qualified DTO name in JPQL.

```java
// example.orders.OrderSummary
public record OrderSummary(Long id, String customerName) { }
```

```java
@Query("""
        select new example.orders.OrderSummary(o.id, c.name)
        from PurchaseOrder o join o.customer c
        order by o.id
        """)
Slice<OrderSummary> findSummaries(Pageable pageable);
```

Call with a validated bounded page size, for example `PageRequest.of(0, 20)`. This selects the customer name in the query and returns no lazy entity association to serialize. It does not retrieve line items; a detail view needs its own plan. Verify generated SQL/query counts rather than assuming a projection fixes every query.

**Projection recall: DTO is the container; projection is the selected result shape.** The query above is a standard JPA constructor projection: it selects scalar values directly into an ordinary DTO/record, not a managed entity. This is not a Spring Data invention. Fetching an entity first and then mapping it to a DTO is different: the entity has already been loaded, and mapping may trigger lazy queries.

Spring Data also supports **interface-based projections**:

```java
public interface OrderIdView {
    Long getId();
}

// Inside the PurchaseOrder repository; assumes a String status property.
List<OrderIdView> findByStatus(String status);
```

Spring Data supplies proxy instances implementing the interface; you do not implement it yourself. A closed projection like this exposes matching entity properties. Nested/open projections can have different loading costs: inspect SQL rather than assuming every projection fetches only a few columns or eliminates N+1.

### 10.14 If a transactional method calls a payment API and then fails, does rollback undo the payment?

**Answer:** no. A local JPA transaction controls its database resource; an ordinary HTTP call to a payment provider does not enlist that provider in the transaction. Rolling back database changes does not reverse an external charge.

**Scenario:** a checkout service saves an order, successfully charges the customer, then throws a runtime exception before the database transaction commits.

```text
Caller -> transaction proxy starts database transaction
           -> save order (not committed yet)
           -> payment API charges customer successfully
           -> later business logic throws RuntimeException
        <- proxy rolls back database transaction

Result: order changes are rolled back; the customer remains charged.
```

Calling `saveAndFlush()` before charging does not solve this: flush is not commit. Keeping the database transaction open throughout the HTTP call also does not create cross-system atomicity; it can hold connections and locks while waiting on the provider.

**Follow-up: "Can I undo the charge?"** If the business outcome requires it, request a void/refund through a separate provider operation. That is **compensation**, not database rollback. Compensation can also fail or time out, so record its status and provide retry/reconciliation. Returning an HTTP error through REST advice does not perform compensation.

**Follow-up: "What if the payment API times out instead?"** The outcome is unknown, not necessarily failed. The provider may have charged the customer before its response was lost. Record an unresolved state and check the provider's status using the payment reference. Where supported, retry with the **same idempotency key** under the provider's documented contract; a new key can create a second charge.

**One practical design: durable intent and asynchronous processing.**

```text
Transaction 1: save pending order/payment intent + outbox work; commit.
Worker: call provider using the intent's stable idempotency reference.
Transaction 2: record confirmed outcome + any next outbox event; commit.
Timeout: keep outcome unresolved; query/reconcile provider status.
```

The outbox makes the intent and work item durable together; it does not make the external charge and local outcome update atomic or guarantee exactly-once delivery. A crash after provider success but before transaction 2 still requires reconciliation or an idempotent repeat. Define pending, confirmed, failed and compensation states according to the business contract rather than treating every exception as "nothing happened."

### 10.15 How do you integration-test database commits, rollbacks and concurrent updates?

**Answer:** run a **database integration test** against a real, running test database, not a mocked repository. The example below exercises the transactional service, Spring Data repository, Hibernate and database together. Mocks cannot verify actual SQL, database constraints or locking.

Use the **same database technology as production, not the production database itself**. For example, if production uses PostgreSQL, start an isolated PostgreSQL instance with Testcontainers and apply the application's actual migrations. "Database integration test" is clearer than "live test," which can imply testing a deployed environment.

**Why does the transaction boundary matter?** A test-level `@Transactional` normally starts a transaction that rolls back after the test. A service using `REQUIRED` can join that transaction instead of committing when its method returns. A test may therefore pass without reaching the commit that would fail in normal application use. An explicit flush can expose some failures, but it does not prove commit succeeded.

For this commit-focused test, omit test-level `@Transactional`: call the service through its Spring proxy so each call completes its own transaction before control returns to the test.

**Scenario:** create an order successfully, attempt another with the same unique checkout reference, then verify that the original remains and no duplicate was committed. Assert the intended exception category and stored result, not vendor error-message wording.

**Sample test skeleton:** `writer.create()` is the transactional method from section 7. Configure the test datasource separately to use the isolated database described above; `@SpringBootTest` alone does not provision it.

```java
@SpringBootTest
class OrderCommitTests {
    @Autowired
    private OrderWriter writer;

    @Autowired
    private OrderRepository orders;

    @Test
    void duplicateCheckoutDoesNotCreateAnotherOrder() {
        CreateOrder command = validOrderWithFreshCheckoutReference();
        Long originalId = writer.create(command);

        assertThatThrownBy(() -> writer.create(command))
                .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(orders.findById(originalId)).isPresent();
        assertThat(orders.countByMerchantIdAndCheckoutReference(
                command.merchantId(), command.checkoutReference()))
                .isEqualTo(1L);
    }
}
```

The fixture helper creates a unique valid command, and the repository declares the shown count query. Verification reads the database after the writer's transaction has completed, rather than inspecting entities left in its persistence context. This test assumes the selected stack translates this uniqueness violation into the shown Spring category; establish that against the actual provider/database. Because there is no enclosing test rollback, explicitly clean up committed fixtures or discard the isolated database.

**Follow-up: "Does this also test concurrency?"** No; these calls are sequential. To test optimistic locking, use separate transactions and persistence contexts, coordinate both workers to load the same entity version before either updates it, then verify that one update succeeds and the other reports a conflict. Concurrent duplicate creation is another separate test. A sequential constraint test does not prove either behavior.

### 10.16 Where should technical translation end and domain meaning begin?

**Answer:** keep Hibernate/JDBC details near persistence integration; let the application translate recognized failures into meaningful outcomes, retaining causes. A shared REST handler maps application failures to status plus stable code. Do not invent a domain wrapper for every technical exception without adding semantics.

**Scenario:** `OrderConflictException` maps to a safe 409; an unrecognized persistence defect remains an internal error with correlated diagnostics. A dependency outage may warrant a service-unavailable policy, but the client must not be told a write definitely failed if its commit outcome is unknown.

**Example translation policy:**

```text
Known checkout-uniqueness violation
    -> replay existing result OR OrderConflictException (per API contract)
    -> REST advice: safe response + stable code

Unknown integrity failure
    -> preserve diagnostic cause; investigate mapping/data invariant
    -> generic internal-error policy, not automatic 409
```

Reuse section 7's `OrderErrors` handler for the HTTP sample. The classification step belongs before that handler; the handler must not guess business meaning by inspecting arbitrary SQL error strings.

### 10.17 Should a search endpoint return `Page` or `Slice`?

**Answer:** start with the client contract. Return `Page` when the screen genuinely needs total results/pages; return `Slice` when content plus "more available" is sufficient. Both accept `Pageable`; neither replaces query tuning.

**Scenario:** an order-management screen shows "247 open orders, page 1 of 25," so a count has product value. A mobile order-history feed only offers "Load more," so paying for a total on every request may be unnecessary. Use section 5's repository examples and look-ahead SQL to explain the difference.

**Follow-up: "How do you prove the improvement?"** Inspect the generated data/count SQL and their query plans with realistic filters and data volumes. Confirm the slice returns at most the requested size and that `hasNext()` is correct for `size - 1`, `size` and `size + 1` matching rows. Use a simple query with no lazy-association accesses when measuring pagination query counts, since unrelated loading can add SQL. Also measure a deep page: removing the count does not remove offset cost.

**Interview recall:** identify the transaction owner, the SQL/flush/commit stage, the translated failure category, the remaining state, and whether retry is safe. Then explain the HTTP contract. Those mechanisms matter more than memorizing Hibernate exception names.

## Change references

**Version change** identifies changed APIs/defaults; **correction** identifies inaccurate/incomplete original material; **addition** identifies missing coverage. Locations refer to the PDF. References were checked for this October 31, 2026 review; current documentation may later advance.

| Original location / claim | Category and correction | Official evidence |
|---|---|---|
| p. 1: every transaction manager creates an EntityManager | Correction: resource management depends on JDBC/JPA/JTA and the selected manager. | [Transaction-manager abstractions](https://docs.spring.io/spring-framework/reference/data-access/transaction/strategies.html) |
| p. 1: rollback only mentions RuntimeException | Correction/addition: ordinary defaults also include Error; checked rules can be customized, including modern global policy. | [Declarative rollback rules](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html) |
| p. 1: `SUPPORTED`; nested always permits continuation | Correction: SUPPORTS; NESTED requires appropriate savepoint support and is not REQUIRES_NEW. | [Propagation](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html) |
| p. 1: readOnly / isolation shorthand | Qualification: hints and outer-scope characteristics depend on manager/resource; joining does not generally replace outer settings. | [JPA transactionality](https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html) and [propagation](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html) |
| p. 1: EntityManager proxy guarantees all access is thread-safe | Correction: a shared proxy routes calls; it does not make actual EntityManagers/entities safe for arbitrary sharing. | [SharedEntityManagerCreator contract](https://docs.spring.io/spring-framework/docs/7.0.10/javadoc-api/org/springframework/orm/jpa/SharedEntityManagerCreator.html) |
| p. 1: fixed JpaRepository method count and universal transaction assumptions | Correction: follow current interfaces and method settings; declared queries and inherited CRUD methods differ. | [JpaRepository API](https://docs.spring.io/spring-data/jpa/reference/api/java/org/springframework/data/jpa/repository/JpaRepository.html) and [transactionality](https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html) |
| p. 2: SimpleJdbcTemplate as current choice | Version-aware replacement: use current JDBC templates or JdbcClient; no first-removal date inferred here. | [Current JDBC operations](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html) |
| pp. 1-2: old Hibernate / javax integration | Version changes: Jakarta migration in Framework 6, provider/injection/native integration changes in Framework 7. | [Framework 6.0 data access](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-6.0-Release-Notes#data-access-and-transactions) and [Framework 7.0 JPA](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes) |
| p. 2: Repository annotation guarantees all translation | Correction: eligibility requires translation infrastructure; templates/repositories have their own integration. | [Persistence exception translation](https://docs.spring.io/spring-framework/reference/data-access/orm/general.html) |
| Save/merge/new detection absent | Addition: save delegates to persist or merge based on entity-new detection. | [Entity persistence](https://docs.spring.io/spring-data/jpa/reference/jpa/entity-persistence.html) |
| p. 2: embedded DB convenience only | Guidance/addition: verify production database behavior with realistic tests; supported engine lists are version-specific. | [Embedded JDBC databases](https://docs.spring.io/spring-framework/reference/data-access/jdbc/embedded-database-support.html) and [Boot Testcontainers](https://docs.spring.io/spring-boot/reference/testing/testcontainers.html) |

Not all of these are new behavior: propagation, rollback-only and EntityManager sharing issues are enduring fundamentals omitted or oversimplified in the old notes.

## Official references

- [Spring transaction management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html)
- [Propagation](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)
- [JPA repository transactions](https://docs.spring.io/spring-data/jpa/reference/jpa/transactions.html)
- [Paging, sorting and result types](https://docs.spring.io/spring-data/commons/reference/repositories/query-methods-details.html#repositories.special-parameters)
- [JPA statement-only query timeout contract](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/QueryTimeoutException.html)
- [Entity persistence and new detection](https://docs.spring.io/spring-data/jpa/reference/jpa/entity-persistence.html)
- [EntityManager lifecycle and operations](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/EntityManager.html)
- [Hibernate 6.6: merging a detached entity whose row was deleted](https://docs.hibernate.org/orm/6.6/migration-guide/#merge-versioned-deleted)
- [Spring Data JPA reference](https://docs.spring.io/spring-data/jpa/reference/index.html)
- [Spring JDBC](https://docs.spring.io/spring-framework/reference/data-access/jdbc.html)
- [Framework 7.0 release notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)

Check the selected framework, provider and database versions before copying exact configuration or assuming defaults.
