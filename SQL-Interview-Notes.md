# SQL: Interview Notes

Reviewed: November 18, 2026. Source: a personal notes document (`SQL Basics.pdf`), Oracle/PL-SQL flavored, covering joins, keys, indexing, cursors, stored procedures/functions, packages, triggers and query-tuning checklists. A second personal document (`DB.pdf`) on concurrency control, isolation levels and ACID contributed the indexing cross-reference below and was otherwise folded into [JPA-ORM-Core-Interview-Notes.md §7](JPA-ORM-Core-Interview-Notes.md#7-locking-optimistic-and-pessimistic) and [§9](JPA-ORM-Core-Interview-Notes.md#9-transactions-the-ejb-way-jta-2pcxa-persistence-context-scope), since that content is really about transaction/locking semantics, not SQL syntax.

You've said you're a backend developer, not primarily a DBA, so this file stays at the level interviewers actually probe backend candidates on: reading an execution plan well enough to explain *why* a query is slow, knowing which query shapes defeat an index, and the PL/SQL building blocks (cursors, procedures, triggers) well enough to discuss trade-offs — not writing production PL/SQL packages from scratch. Where Oracle-specific syntax is shown, the general concept (not the dialect) is what interviewers are grading.

Companion guides: [JPA/ORM Core](JPA-ORM-Core-Interview-Notes.md), [Spring Data](Spring-Data-Interview-Notes.md).

## Contents

1. Joins
2. Keys: candidate, primary, unique, foreign
3. Indexing: clustered vs non-clustered, the B+ tree, composite column order
4. `EXISTS` vs `IN` (and the `NOT IN` NULL trap)
5. Query tuning checklist
6. Reading execution plans
7. Procedural SQL: cursors, procedures vs functions, packages, triggers
8. Interview questions
9. Postgres: governance, extensibility, and how it compares

## 1. Joins

| Join | Returns |
|---|---|
| `INNER JOIN` | Only rows with a match on both sides |
| `LEFT (OUTER) JOIN` | All left rows, matched right columns or `NULL` |
| `RIGHT (OUTER) JOIN` | All right rows, matched left columns or `NULL` — rare in practice; most people just flip the table order and use `LEFT JOIN` instead, so recognize it more than you'll write it |
| `FULL (OUTER) JOIN` | Union of left and right outer joins — unmatched rows from both sides, `NULL` on whichever side didn't match |
| `CROSS JOIN` | Cartesian product, every left row paired with every right row — usually a missing-join-condition bug unless it's intentional (e.g., generating a date-range × category grid) |
| Self join | A table joined to itself via an alias, typically for hierarchical/parent-child data in the same table (`employees e JOIN employees m ON e.manager_id = m.id`) |

**How the engine actually executes a join** (worth knowing even though you don't pick this — the optimizer does): **nested loop** (for each outer row, scan/seek the inner table — good when the outer side is small and the inner side has a usable index), **hash join** (build an in-memory hash table on the smaller input, probe it with the larger — good for large, unindexed equi-joins), **merge join** (both inputs already sorted on the join key, walk them in lockstep — good when both sides are already ordered, e.g. by an index). If a plan shows a nested loop over a large unindexed table, that's the tuning red flag, not the join type you wrote in SQL — you wrote a join; the engine chose *how*.

## 2. Keys: candidate, primary, unique, foreign

| Key type | Meaning |
|---|---|
| **Candidate key** | Any column (or column set) that *could* uniquely identify a row; a table can have several |
| **Primary key** | The candidate key chosen as the table's main identifier; exactly one per table, implicitly `NOT NULL`, usually backs the clustering/physical row order |
| **Unique key** | Enforces uniqueness like a primary key but allows `NULL` (dialect-dependent: most engines allow multiple `NULL`s since `NULL <> NULL`), and a table can have several |
| **Foreign key** | A column (or set) that references another table's primary/unique key, enforcing referential integrity — a row can't reference a parent that doesn't exist |

Foreign keys carry an `ON DELETE`/`ON UPDATE` action: `CASCADE` (deleting the parent deletes dependents too), `SET NULL` (dependents' FK column is nulled — only valid if that column is nullable), `RESTRICT`/`NO ACTION` (block the parent delete while dependents exist — the common, safest default), `SET DEFAULT` (rare). "What happens to orders when you delete a customer" is really this question in disguise — answer with the specific action and why it was chosen (don't just say "foreign key exists").

## 3. Indexing: clustered vs non-clustered, the B+ tree, composite column order

**B+ tree**, not a plain binary tree, is the standard index structure: all actual key values live in the **leaf** nodes (which are also linked to each other, enabling fast ordered range scans), internal nodes exist purely to route a search down to the right leaf quickly, and the tree stays balanced (same leaf depth everywhere) as rows are inserted/deleted, which is what keeps lookups at roughly `O(log n)` regardless of table size.

**Clustered index**: the table's rows are **physically stored** in index key order — there can be only one per table (a row can only be physically sorted one way), and it's usually the primary key by default. **Non-clustered index**: a separate structure holding the indexed column(s) plus a pointer/row-locator back to the actual row — a table can have many of these. Practical consequence: a lookup via a non-clustered index that needs other, non-indexed columns requires a second hop back to the table (a "bookmark lookup" / "key lookup") unless the index is **covering** (includes every column the query needs, so the engine never touches the base table at all) — "why is this query still slow even though it uses an index" is very often answered by "it's using a non-covering index and paying for the lookup."

**Composite index column order matters**: an index on `(a, b, c)` can serve a query filtering on `a` alone, or `a` and `b`, or all three (leftmost-prefix rule), but **cannot** efficiently serve a query filtering on `b` or `c` alone, because the tree is sorted by `a` first. Put the column with an equality filter and highest selectivity leftmost, and a column you range-filter (`>`, `<`, `BETWEEN`) as the rightmost *useful* column in the index, since everything after a range predicate in the key can't be used for further narrowing in that same index.

**Indexes aren't free**: every `INSERT`/`UPDATE`/`DELETE` has to maintain every index on that table too, so a write-heavy table with ten indexes on it is paying ten extra B+ tree maintenance costs per write — the real trade-off interviewers want you to voice isn't "indexes are good," it's "index the columns that are actually filtered/joined/sorted on frequently, and stop there."

## 4. `EXISTS` vs `IN` (and the `NOT IN` NULL trap)

`EXISTS` short-circuits — the moment the correlated subquery finds **one** matching row it stops, which tends to make it the better choice when the subquery's result set is large. `IN` materializes the full subquery result set first, which tends to be fine (and sometimes faster, since many optimizers rewrite `IN` into a semi-join anyway) when that set is small. In practice, on a modern optimizer (Oracle/PostgreSQL/SQL Server), both are usually rewritten to the same semi-join plan for simple cases — don't over-claim a universal performance difference; the one genuinely load-bearing fact to know is the next one.

**The `NOT IN` NULL trap**: `WHERE col NOT IN (SELECT nullable_col FROM other_table)` silently returns **zero rows** if even one row in the subquery has a `NULL` in `nullable_col` — because `x <> NULL` evaluates to `UNKNOWN`, not `TRUE`, for every comparison, and `UNKNOWN` combined with `AND` across the whole `NOT IN` expansion poisons the entire result. `NOT EXISTS` (or `WHERE col NOT IN (SELECT nullable_col FROM other_table WHERE nullable_col IS NOT NULL)`) doesn't have this problem. This is a genuinely common production bug — "why did this `NOT IN` query suddenly return nothing after someone inserted a row with a NULL" is a real-world story worth having ready.

## 5. Query tuning checklist

- **Avoid `SELECT *`**: pulls columns you don't need (I/O and network cost). An index's *seek* role (finding matching rows via the predicate) is unaffected by which columns you select — but its *covering* role (satisfying the whole query from the index alone, with no lookup back to the table) depends on the output columns too. `SELECT *` forces every column into the output, so even a perfectly-matched index can't cover it, and the engine pays a key/bookmark lookup per row it would otherwise have avoided.
- **Don't wrap an indexed column in a function or do an implicit type conversion in the predicate** (`WHERE UPPER(last_name) = 'SMITH'`, or comparing a `VARCHAR` column to a numeric literal that forces an implicit cast): the index is built on the raw column value, so the engine can't use it to seek — it falls back to scanning every row and applying the function per row. Either index the expression itself (a function-based/expression index, where supported) or restructure the predicate to leave the column bare.
- **Leading wildcard `LIKE '%term'` can't use a standard B+ tree index** (it doesn't know where in the sorted order a mid-string match would start) — `LIKE 'term%'` can. If leading-wildcard search is a real requirement, that's a sign you need a different structure entirely (full-text index, trigram index), not a bigger regular index.
- **Rewrite correlated subqueries as joins where possible**: a correlated subquery re-executes once per outer row; the optimizer sometimes flattens it into a join automatically, but don't count on it — write the join explicitly when the logic allows it.
- **`WHERE` filters rows before grouping; `HAVING` filters groups after aggregation`** — putting a non-aggregate condition in `HAVING` instead of `WHERE` forces the engine to aggregate rows it could have discarded first, which is strictly more work for no semantic benefit. Only use `HAVING` for conditions that are genuinely about the aggregate (`HAVING COUNT(*) > 5`).
- **`OR` across columns that each have their own separate index** often can't use either index efficiently in one pass (some optimizers rewrite it as an index-union internally, but don't assume it) — an explicit `UNION`/`UNION ALL` of two separately-indexed queries is sometimes the faster, more predictable rewrite.
- **Bind variables over literal-concatenated SQL**: beyond the SQL-injection reason, literal values mean the engine can't reuse a cached execution plan (or, on Oracle, floods the shared pool with one plan per distinct literal) — parameterized queries are a performance concern, not just a security one.

## 6. Reading execution plans

Oracle: `EXPLAIN PLAN FOR <query>` then query `PLAN_TABLE` (or just turn on `SET AUTOTRACE ON` in SQL*Plus/SQL Developer for execution + plan + stats together). PostgreSQL: `EXPLAIN (ANALYZE, BUFFERS) <query>`. SQL Server: "Include Actual Execution Plan." The dialect differs; what you're hunting for in the output doesn't:

- **Read innermost/deepest operation first** — plans are usually rendered as a tree where the deepest-indented or innermost step executes first and feeds rows upward/outward to the step above it.
- **Full table scan vs index scan vs index seek**: a scan (table or full index) reads every row/every index entry; a seek seeks directly via the B+ tree to the matching range. A full table scan on a large table, where you expected an index to be used, is the single most common "why is this slow" finding.
- **Estimated vs actual row counts** (only visible with `ANALYZE`/actual-plan modes, not plain `EXPLAIN`): a large gap between the optimizer's row-count *estimate* and the *actual* rows returned means statistics are stale or the predicate is one the optimizer can't estimate well (e.g. a correlated-column filter) — and a bad estimate is what causes the optimizer to pick the wrong join algorithm or join order in the first place, so this is often the *root cause* behind a scan-instead-of-seek finding, not just a secondary detail.
- **Cost is relative, not absolute**: the "cost" number is the optimizer's own internal unit for comparing candidate plans against each other for *this* query — don't compare cost numbers across unrelated queries.

## 7. Procedural SQL: cursors, procedures vs functions, packages, triggers

**Cursors**: a cursor is a named handle to a query's result set that lets you fetch it row by row. An **implicit** cursor is created automatically for a plain `SELECT INTO`/DML statement you don't explicitly declare; an **explicit** cursor (`DECLARE ... CURSOR ... OPEN ... FETCH ... CLOSE`) is one you declare yourself to iterate a multi-row result inside PL/SQL. The interview-relevant trade-off: row-by-row explicit-cursor processing ("slow by slow," as the saying goes) is almost always slower than a single set-based SQL statement (`UPDATE ... WHERE ...`, a bulk `MERGE`) doing the same work in one pass — reach for an explicit cursor only when you genuinely need per-row procedural logic that can't be expressed as one set-based statement, not as a default way to "process a table."

**Stored procedure vs function**: a **procedure** is invoked as a standalone statement (`CALL proc(...)` / `EXEC proc`), may or may not return a value via `OUT` parameters, and can't be used inside a `SELECT` expression. A **function** must return exactly one value, generally shouldn't have side effects on data (DML inside a function is restricted or disallowed in some engines precisely to keep it safe to call from within a query), and can be used directly in a `SELECT`/`WHERE` expression. If you need to call it from inside a query, it has to be a function.

**Packages** (Oracle-specific grouping construct — most other engines don't have a direct equivalent): a package bundles related procedures/functions/types under one namespace (spec = public interface, body = implementation), and critically, a package can hold **package-level state** (variables that persist for the duration of a session) — which is both the main reason to use one (shared session-scoped state, logical grouping, single compile unit) and a classic interview gotcha, since that state is *per session*, not shared across sessions/connections the way a global in an application server might be.

**Triggers**: fire automatically on a DML event (`BEFORE`/`AFTER` `INSERT`/`UPDATE`/`DELETE`), either **row-level** (`FOR EACH ROW`, fires once per affected row, with `:OLD`/`:NEW` pseudo-records available) or **statement-level** (fires once regardless of how many rows the statement touched). The classic gotcha interviewers probe for is the **mutating table error**: a row-level trigger on table `T` generally can't query or modify `T` itself mid-statement (the table is "mutating" from the engine's point of view while the firing statement is still in progress) — the common workaround is a compound trigger (statement-level + row-level combined, collecting state in the row-level portion and acting on it once in an `AFTER STATEMENT` section) or restructuring the logic to avoid the self-reference entirely.

## 8. Interview questions

1. What's the difference between a clustered and a non-clustered index, and why can a table have only one clustered index?
2. You added an index on the exact column in your `WHERE` clause and the query is still doing a full table scan — what's the first thing you'd check?
3. Why does `NOT IN` sometimes silently return zero rows, and how would you rewrite it to avoid that?
4. When would you choose a hash join over a nested loop, and who actually makes that choice — you or the optimizer?
5. What's the practical difference between a stored function and a stored procedure, and which one can you call from inside a `SELECT`?
6. Why is row-by-row cursor processing usually slower than a single set-based `UPDATE`, and when is a cursor still the right tool?
7. What is a mutating-table error, and how would you work around it in a row-level trigger?
8. Column order in a composite index — why does `(last_name, first_name)` not help a query that filters on `first_name` alone?
9. What's the difference between `WHERE` and `HAVING`, and why does putting a filterable condition in `HAVING` by mistake cost you performance?
10. How do you read an execution plan well enough to tell your team *why* a query is slow, not just *that* it is?

## 9. Postgres: governance, extensibility, and how it compares

This is awareness-level, system-design-adjacent content — not syntax or tuning — kept here because "why Postgres" and "Postgres vs. X" are common framing questions before a deeper SQL discussion starts.

**Why it's reverred beyond "open source + JSON":**
- **Governance.** Postgres has no owning company — a community project under a permissive BSD-style license, unlike MySQL (Oracle-owned) or Redis/Elastic/MongoDB/Terraform, all of which relicensed away from fully open-source once commercial pressure hit. For a long-horizon bet, that de-risking matters more than any single feature.
- **Extensibility is the actual killer feature.** Designed since 1986 to let new types, operators, index methods and procedural languages be added without forking the engine. That is *why* it keeps absorbing categories: PostGIS (geospatial), pgvector (vector search), TimescaleDB (time-series), Citus (sharding), foreign data wrappers (query Mongo/S3/Oracle/CSV as if local), JSONB (document use cases), full-text search, and `LISTEN/NOTIFY` + `SKIP LOCKED` (simple queueing). "Just use Postgres" is a legitimate architecture: one system instead of five avoids dual writes, N backup/upgrade/on-call stories, and no cross-store joins.
- **Correctness culture.** Real transactional DDL (`BEGIN; ALTER TABLE ...; ROLLBACK;` actually rolls back), strict typing and constraints taken seriously, no silent data mangling, and a strong distributed-correctness track record (Jepsen).
- **A genuinely strong query engine.** MVCC (readers never block writers and vice versa), a sophisticated cost-based planner (CTEs, window functions, lateral joins, parallel execution), and an unusually wide index variety (B-tree, Hash, GIN for JSONB/arrays/FTS, GiST for geo/ranges, SP-GiST, BRIN for huge append-only tables), plus partial/expression/covering indexes.
- **Ecosystem flywheel.** The permissive license made it the base for Aurora/RDS, AlloyDB, Azure Database for PostgreSQL, Supabase, Neon, CockroachDB and Yugabyte (wire-protocol compatible) — the Postgres wire protocol has become an industry lingua franca similar to S3's API.

**Honest weaknesses:** one process per connection (needs PgBouncer at scale), vacuum/XID-wraparound operational burden, no built-in multi-master or automatic failover (bolt on Patroni), and logical replication is still maturing.

**Postgres vs. MySQL — not a complete no-brainer.** Postgres wins on correctness/constraints, extensibility, query power, and richer native types. MySQL still wins on built-in replication/HA (Group Replication, InnoDB Cluster, more turnkey than "bolt on Patroni"), thread-per-connection handling thousands of connections without a pooler, no vacuum-style purge surprise, a clustered index on the primary key (faster PK range scans), simpler major-version upgrades, and proven extreme scale (Vitess sharding, PlanetScale). Rule of thumb: Postgres is the better **default**; MySQL is the better **specialist** for high-connection, high-write, simple-schema, heavily-sharded workloads — and the deciding factor is usually the team's existing operational experience, not the engine itself.

**Postgres vs. NoSQL/specialist databases — "eating the market from below."** Postgres reaches "good enough for the 90th percentile of workloads" and the operational savings of one system then outweigh the marginal performance of a specialist (classic disruption from below). The rule for *when* it succeeds: it absorbs a category when the specialist's advantage was a **data model or index type** (its 1986 extensible architecture was built for exactly that); it does **not** absorb a category when the advantage is a **fundamentally different architecture**.

| Specialist | Postgres answer | Verdict |
|---|---|---|
| Pinecone / Weaviate (vector) | `pgvector` | Mostly lost — default choice now; specialists survive only at billion-vector scale |
| MongoDB | JSONB + GIN | Largely lost — little left the engine does better; Mongo's edge is now Atlas/DX, not the database |
| Elasticsearch | FTS, GIN, `pg_trgm`, ParadeDB (`pg_search`/BM25) | Holding — Postgres FTS is genuinely production-sufficient when search is a *feature* (your app's own records, filterable by relational data like `tenant_id`); Elastic still wins when relevance tuning *is* the product, or for fuzzy/typo tolerance and log analytics at volume |
| InfluxDB | TimescaleDB | Mostly lost |
| Redis | `UNLOGGED`, `SKIP LOCKED`, `LISTEN/NOTIFY` | Surviving strongly — the latency class is physically different; Postgres is not a cache substitute |
| Cassandra / DynamoDB | Citus, partitioning | Surviving — masterless, multi-region writes and linear horizontal scale are a different architecture |
| Neo4j | Recursive CTEs | Holding — recursive CTEs cover real production work (org charts, permission trees, taxonomies, BOM, threaded comments) at typical depths; Neo4j earns its place for deep (5+ hop) traversal, graph algorithms, or when the graph *is* the domain, not merely "the data looks like a graph" |
| Snowflake / BigQuery / ClickHouse (OLAP) | — | Safe — columnar storage and vectorized execution at petabyte scale is a different machine |
| Kafka | — | Safe — log-centric streaming, replay and consumer groups are not a database problem |

**Better heuristic than a feature checklist:** ask whether the specialist's capability is the *core of the product* or a *supporting feature*. Search as a feature → Postgres; search as the product → Elastic. Hierarchy as a feature → Postgres; graph as the product → Neo4j. The checklist always favors the specialist; the operational bill always favors consolidation.
