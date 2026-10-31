# Spring Data and Data Access: Interview Notes

Reviewed: October 31, 2026. Source: the two-page Spring Data PDF, dated May 21, 2018.

The source is mostly Spring transaction management, ORM integration and JDBC, with only a short Spring Data JPA section. This editorial Markdown conversion retains those foundations, corrects misleading claims, and adds the repository/persistence/performance material missing from its title. It is not a verbatim transcript.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> [Boot](Spring-Boot-Interview-Notes.md) -> [REST + MVC](Spring-REST-MVC-Interview-Notes.md) -> **Data** -> [Security](Spring-Security-Interview-Notes.md).

## Relevance and original-topic coverage

| PDF pages | Original coverage | Assessment |
|---|---|---|
| 1 | Local/global transactions, `@Transactional`, propagation | High value; several details incorrectly generalize JPA behavior to all managers. |
| 1 | Hibernate/JPA integration, shared EntityManager, repository proxies | Keep, but remove the blanket thread-safety guarantee and fixed method counts. |
| 2 | ORM integration benefits, JDBC templates, embedded databases, translation | Keep; SimpleJdbcTemplate is obsolete, and embedded DB tests need realism checks. |

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

## 5. Spring Data repositories

`JpaRepository<Entity, ID>` supplies JPA-specific repository functionality. Do not memorize the PDF's "18 inherited methods"; interfaces and inheritance have changed over releases.

Repository infrastructure creates proxies backed by implementations and query machinery. The source correctly describes conventional runtime repository creation, but its absolute "never build-time generation" statement should not be extended to all modern AOT arrangements.

Repositories can be discovered through Boot auto-configuration or explicit `@EnableJpaRepositories`; `<jpa:repositories>` is legacy XML recognition material.

**Added essential concepts:**

- Derived query methods, `@Query` JPQL, native SQL, parameter binding and query validation.
- Projections/DTOs, Specifications or another query-composition approach where appropriate.
- Custom repository fragments for queries/operations that do not fit a derived method.
- `Page` versus `Slice`: `Page` commonly requires a total-count query; `Slice` primarily reports whether more data exists.
- Stable sorting and bounded pagination; consider keyset scrolling for large datasets when supported.
- `save` chooses persist or merge based on entity-new detection, not "always insert" or "always immediately execute SQL". Use its return value, especially when merge is involved.
- Bulk update/delete can bypass entity lifecycle/dirty checking and leave managed state stale; consider flush/clear strategy and transaction boundaries.

Inherited CRUD methods have default transaction settings in the JPA implementation. Declared query methods do not all inherit transactional configuration by default. The outer service transaction governs participating operations; do not assume every repository annotation starts a separate transaction.

## 6. Persistence performance and correctness

**Added, high priority for experienced interviews:**

- Explain N+1 queries and verify actual SQL/query counts. Use projections, fetch joins, entity graphs or batching deliberately; making everything eager is not a universal fix.
- Understand `LazyInitializationException`; Open EntityManager in View can allow access later but may hide query cost. Prefer deliberate loading and DTO boundaries.
- Be careful paginating collection fetch joins; logical entity pages and SQL row pages can differ.
- `@Version` supports optimistic locking; pessimistic locks have contention/deadlock trade-offs. Use database constraints for uniqueness/invariants.
- Know relationship ownership, cascades and orphan removal; cascade is not authorization or permission to delete shared entities.
- Size connection pools, keep transactions short, inspect indexes/query plans, and distinguish first-level persistence-context caching from optional second-level caches.
- Test concurrent updates and migrations; an ORM abstraction does not remove database-specific behavior.

## 7. JDBC and exception translation

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

## 10. Interview drills

- Two repository writes succeed individually but must succeed together. Place the transaction boundary.
- A caught inner exception still makes the outer commit fail. Explain rollback-only.
- `save` returns a different instance. Explain merge and managed state.
- `flush` succeeds, then another operation fails. Explain why flush was not commit.
- A list endpoint executes hundreds of queries. Diagnose N+1 and choose a fetch strategy.
- Two clients overwrite each other's updates. Discuss optimistic locking and constraints.
- A transaction contains a model call and a database write. Explain why the remote action is not atomically rolled back.

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
- [Entity persistence and new detection](https://docs.spring.io/spring-data/jpa/reference/jpa/entity-persistence.html)
- [Spring Data JPA reference](https://docs.spring.io/spring-data/jpa/reference/index.html)
- [Spring JDBC](https://docs.spring.io/spring-framework/reference/data-access/jdbc.html)
- [Framework 7.0 release notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)

Check the selected framework, provider and database versions before copying exact configuration or assuming defaults.
