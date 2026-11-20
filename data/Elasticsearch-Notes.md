# Elasticsearch: Core Concepts, Mapping, Search Internals, and Tuning

Source: personal Elasticsearch notes covering core concepts, Java client evolution, mapping, the index/search internals, and performance tuning.

**Context that shapes this file:** typical usage pattern is Elasticsearch consumed *behind an abstraction* (a search service / repository layer sitting on top of the client), so day-to-day coding rarely touches raw query DSL or client internals directly. That's a normal, defensible production pattern — but interviewers probe underneath the abstraction precisely because that's where the real understanding (or the gap) shows up. This file is organized to go from "what the abstraction hides" outward: core concepts first, then the client layer, then mapping/indexing, then search internals, then the modeling problems and tuning knobs that actually come up when someone asks "why is this slow" or "how would you model X."

Related: [Spring Boot](../spring/Spring-Boot-Notes.md) (Spring Data Elasticsearch repositories are exactly the abstraction layer referenced above), [SQL](SQL-Notes.md) (indexing/query-plan parallels — ES's inverted index vs. a B-tree index is a recurring comparison interviewers like).

## 1. Core concepts — the vocabulary underneath the abstraction

| ES term | What it actually is | Closest RDBMS analogy (careful — imperfect) |
|---|---|---|
| Index | A logical collection of documents, physically split into shards | Database / table |
| Document | A JSON object, the unit of storage and retrieval | Row |
| Type (deprecated since 6.x, removed in 7.x+) | Used to be a way to partition documents within an index | Historically "table within a database"; removed because it encouraged a mapping model (shared Lucene segment, incompatible field types across "types") that caused more problems than it solved |
| Field / Mapping | A document's property and its declared type/analysis behavior | Column + column type/constraint |
| Node | A single running instance of Elasticsearch | DB server instance |
| Cluster | A set of nodes working together, sharing cluster state | DB cluster |
| Shard (primary) | A physical, independent Lucene index — the unit ES actually distributes and searches in parallel | Horizontal partition |
| Replica (shard) | A copy of a primary shard, for both HA and read-throughput scaling | Read replica |

**"Near real-time" is a precise claim, not marketing language:** a write isn't immediately searchable. It's refreshed into a searchable, in-memory segment (default interval ~1s) before it's queryable, and only fsynced/flushed to disk periodically. If an interviewer asks *"why would a document I just indexed not show up in a search right after indexing?"*, this refresh interval is the answer — not a bug, not eventual-consistency hand-waving, a specific configurable knob (`index.refresh_interval`).

**Why document stores like ES exist alongside RDBMS, not instead of it:** full-text relevance ranking (BM25/TF-IDF scoring), near-schema-less documents with nested/array fields, and horizontal scale-out via sharding are all things an RDBMS does poorly or not at all. The trade is: no multi-document ACID transactions (pre-7.x; still no cross-shard transactional guarantee the way an RDBMS has), eventual (near-real-time) visibility instead of immediate read-your-writes, and relevance scoring instead of exact relational joins.

**Practical interview framing when you've only used it behind an abstraction:** "I've driven it through `ElasticsearchRepository`/a search-service wrapper for indexing and filtered queries; what I'd want to go deeper on hands-on is raw query DSL for scoring/aggregations and cluster-level shard sizing" is an honest, credible answer — it names the real boundary instead of overclaiming.

## 2. Java client evolution — know why it changed, not just the names

| Client | Era | Characteristic | Why it was replaced |
|---|---|---|---|
| **TransportClient** | Pre-7.x | Binary, node-to-node protocol; client literally joined the cluster as a lightweight node | Tightly coupled to internal protocol versions — a client build had to match the cluster's major version almost exactly, which made rolling upgrades painful. Deprecated in 7.0, removed in 8.0. |
| **Low-level REST Client** | 5.x+ | Thin HTTP wrapper — you hand-build JSON request bodies and parse JSON responses yourself | No version lock-in (plain HTTP/JSON survives cluster upgrades), but verbose and error-prone for complex queries |
| **High-level REST Client (HLRC)** | 6.x-7.x | Request/response Java objects on top of the low-level client — built the JSON for you | Deprecated in 7.15+ in favor of... |
| **Java API Client (`co.elastic.clients`)** | 8.x+ | Fully typed, fluent builder API over HTTP, no server-internals coupling | Current recommended client |

The throughline across all four: ES moved from a protocol that required the client to understand cluster internals to a client that only ever speaks HTTP/JSON — that's the real "why," and it's also *why* an abstraction layer (Spring Data Elasticsearch, a custom search-service) ages better than code that imports a specific low-level client class.

## 3. Mapping — the schema the abstraction is managing for you

**Dynamic vs. explicit mapping:** ES will infer a type from the first document it sees for a new field (dynamic mapping) — convenient for prototyping, dangerous in production because a single bad first document (e.g., a numeric-looking string, or a date-looking string) locks in the wrong type for that field going forward, and you can't change a field's type without reindexing. Production systems should declare an explicit mapping before the first write.

**Key mapping parameters and what they actually control:**

| Parameter | What it does | When it bites you |
|---|---|---|
| `type` | Declares the field's data type (`text`, `keyword`, `long`, `date`, `nested`, ...) | Mixing `text` (analyzed, for full-text search) and `keyword` (exact-match, for filters/aggregations/sorting) on the same logical field is the single most common ES mapping mistake — a `text` field alone can't be used for exact filtering or sorting; a `keyword` field alone can't do partial/full-text match |
| `analyzer` | Controls tokenization + normalization applied at **index time** for `text` fields (lowercase, stemming, stopwords, etc.) | Choosing the wrong analyzer (or the default `standard` analyzer) for a language/domain silently degrades search relevance — no error, just bad results |
| `search_analyzer` | Overrides the analyzer used at **query time** (defaults to the index-time analyzer if unset) | Needed when you want asymmetric behavior, e.g. synonym expansion only on the query side |
| `normalizer` | Like an analyzer, but for `keyword` fields — applies simple char-level transforms (e.g. lowercasing) without tokenizing | Forgetting this is why `keyword` "exact match" filters can still miss on case differences |
| `boost` | Statically multiplies a field's relevance score contribution | Overused boosts become unmaintainable relevance tuning spaghetti — usually a smarter query (e.g. `multi_match` with per-field boosts, or function_score) ages better than many static per-field boosts scattered through the mapping |
| `index` (true/false) | Whether the field is indexed (searchable) at all | Setting `false` on a field you later need to filter/aggregate on means a full reindex to fix — the opposite of free |
| `enabled` (false) | ES stores the field but doesn't parse/index it at all — it's a dead blob except for `_source` retrieval | Useful for opaque JSON blobs you need to retrieve but never query |
| `store` (true/false) | Whether the field value is stored independently of `_source` for cheaper standalone retrieval | Rarely needed — `_source` already holds the raw document; `store` is a narrow optimization, not a default |

**Reindexing is the recurring "gotcha" theme:** because a field's type can't be changed in place, any mapping correction (wrong analyzer, `text` vs `keyword` mistake, newly needed `nested` structure) requires creating a new index with the corrected mapping and reindexing all documents into it (the `_reindex` API), then swapping an alias to point at the new index. This alias-swap pattern — write/read through an alias, never a raw index name — is the practical answer to *"how do you change a mapping without downtime?"*

## 4. Indexing, mapping, searching — the three moving parts

Everything in ES functionally decomposes into three aspects, and most "why is this behaving unexpectedly" questions map to exactly one of them:

1. **Indexing** — how a document gets written, analyzed, and turned into Lucene segments (refresh interval, bulk vs. single writes, shard routing).
2. **Mapping** — the schema governing how each field is analyzed/stored (§3 above).
3. **Searching** — how a query is parsed, scored, and matched against those segments (this section).

**Query phase, then fetch phase — not one round trip:** a search request executes in two phases. The **query phase** asks every relevant shard for the IDs and scores of its top-N matching documents (not the full documents); the coordinating node merges these into a single globally-ranked top-N list. The **fetch phase** then goes back to only the shards holding those specific winning documents and retrieves their full `_source`. This is *why* deep pagination (`from`/`size` far into result set) is expensive: the query phase still has to compute and sort `from + size` candidates **per shard**, even though you only fetch the last page — cost grows with pagination depth, not just page size, which is the direct lead-in to why `search_after` / the Scroll API exist for deep pagination instead of raw `from`/`size`.

**`bool` query — `must` vs `should`, the distinction that actually matters:**
- `must` — clause has to match; contributes to relevance score (like SQL `AND`).
- `filter` — clause has to match; does **not** contribute to score and is cacheable — this is the one most people forget exists and should default to for any yes/no condition (status = active, date range, tenant ID) that isn't itself part of relevance.
- `should` — if inside a `bool` with no `must`/`filter`, at least one `should` must match (acts like `OR`); if a `must`/`filter` is also present, `should` clauses are optional but boost the score when matched.
- `must_not` — clause must not match; no scoring contribution (it's a filter on absence).

The practical rule an abstraction layer usually gets right but is worth being able to say out loud: anything you'd phrase as "and it must also be true that..." for a non-relevance condition belongs in `filter`, not `must` — that's free caching and no wasted scoring work.

**Other search behaviors worth naming precisely, because they're easy to get vague on:**
- **`_source` filtering** — you can request only specific fields back from `_source` instead of the whole document, cutting network payload for wide documents when you only need a few fields.
- **Aggregations** — computed over the full matching set (not just the returned page), used for facets/analytics; they run as a second, separate computation alongside the query, which is why heavy aggregations on huge result sets are a common performance complaint.
- **Scroll API (legacy) vs `search_after` (current):** both exist to walk *all* matching documents (not a bounded page) without the cost blowup of deep `from`/`size` pagination. Scroll keeps a server-side point-in-time snapshot open (resource cost, and results won't reflect concurrent writes); `search_after` is stateless, cursor-based on sort values, and is the modern recommendation — the difference is exactly the stateful-snapshot-vs-stateless-cursor tradeoff.
- **Rescoring** — re-ranks only the top-N results of an initial (cheap) query with a more expensive scoring function, instead of applying that expensive function to the entire candidate set — a direct answer to "how do you do expensive relevance scoring without killing performance."
- **Refresh and segments** — each refresh creates a new, small, immutable Lucene segment; background merges combine small segments into larger ones over time. More frequent refreshes (more real-time visibility) means more segments means more merge work — this is the direct mechanism behind the indexing-throughput-vs-search-latency tradeoff, not just an abstract tradeoff statement.

## 5. Common modeling problems — the "how would you build X" questions

| Problem | ES-native approach | Why it's not "just SQL with search bolted on" |
|---|---|---|
| **Faceted search** (e.g. e-commerce filters: brand, price range, in-stock) | Aggregations (`terms`, `range`) run alongside the main query, computed over the full matching set | A single request returns both the result page and every facet's counts — no N+1 "count per category" queries |
| **Full-text search** | `match`/`multi_match` queries against analyzed `text` fields, scored by BM25 | This is the whole reason ES exists over a `LIKE '%term%'` query — relevance ranking, not just substring matching |
| **Autocompletion** | `completion` suggester (a dedicated, in-memory FST structure) or edge n-gram analyzers on a dedicated field | A `completion` field is a different data structure entirely from a searchable `text` field — it's optimized for prefix matching at very low latency, not general search |
| **Spell checking / "did you mean"** | Term/phrase suggesters comparing against indexed terms, or a fuzzy (`fuzziness`) match | Fuzzy matching (edit-distance tolerant) is a query-time option, not a separate index |
| **Update-heavy data modeled as insert-heavy** | Parent-child relationships (or `nested` documents) instead of constantly re-indexing a whole denormalized document on every child update | Lucene segments are immutable — an "update" is actually delete + reindex of the whole document; if children change far more often than parents, modeling them as separate parent-child documents avoids rewriting the (expensive, rarely-changing) parent on every child change |

**Nested vs. parent-child, the follow-up question:** `nested` documents live in the same Lucene block as their parent (fast joins, but the whole block still gets reindexed together on *any* change to parent or children) while parent-child are genuinely separate documents joined at query time (child updates are cheap and independent, but parent-child queries are slower than nested queries and don't support the same aggregation richness). The decision is a straight tradeoff: how often do children change independently of the parent, versus how much query-time join cost you can tolerate.

## 6. Performance tuning — the levers, and which problem each one answers

| Lever | Answers which problem |
|---|---|
| **Bulk requests, sized to a reasonable batch (not one-at-a-time indexing)** | Indexing throughput — per-request overhead dominates when indexing one document at a time |
| **Increasing the indexing buffer size (`indices.memory.index_buffer_size`)** | Lets more in-memory indexing happen before a forced refresh/flush, trading memory for indexing throughput |
| **Fewer replicas during a bulk load, restored after** | Every replica is a full extra write — temporarily dropping replica count (then raising it back) speeds bulk ingestion at the cost of HA during the load window |
| **Sharding strategy (shard count chosen up front)** | Too few shards caps parallelism and makes a hot index hard to redistribute; too many shards adds per-shard overhead (each shard is a full Lucene index with its own resource cost) — this is why shard count can't be freely changed after index creation and needs sizing *before* the index exists, not after it's slow |
| **Customizing field mappings (disable `index` on fields never searched, disable `_all`/equivalent catch-all fields in modern versions, disable `norms` when scoring/relevance doesn't matter for a field)** | Indexing cost and index size — every field ES fully indexes/analyzes costs write time and disk; fields that only ever need `_source` retrieval shouldn't be indexed/analyzed at all |
| **Disabling `_source` (rare, deliberate tradeoff)** | Saves disk/indexing cost, but you lose the ability to reindex, do partial updates, or retrieve full documents — basically never worth it unless the index is write-only analytics data you never need to re-derive from |
| **Thread pool sizing (search/index/bulk pools)** | Matching thread pool capacity to actual node hardware and workload shape — undersized pools cause request rejection under load; oversized pools cause context-switch thrashing |
| **Profile API** | The `EXPLAIN PLAN` equivalent for ES — breaks down exactly where time went inside a query (which clause, which phase) instead of guessing from aggregate latency; this is the right first move when "a query is slow" and you need to know *why* before reaching for any lever above |

**Interview-ready synthesis, one sentence per lever category:** throughput problems are solved by batching writes and relaxing replication during the load; search-latency problems are solved by not indexing/scoring fields you don't need and by measuring with the Profile API before guessing; capacity problems are solved by sizing shards and thread pools to the actual workload up front, because both are expensive to change after the fact.
