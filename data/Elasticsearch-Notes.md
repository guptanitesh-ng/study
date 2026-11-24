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

**Reindexing:** changing an existing field's type or index-time analyzer generally requires a new index with corrected mappings, backfilling with `_reindex`, and switching an alias.

`_reindex` does not copy destination mappings or settings; create and configure the destination first. The alias switch itself does not copy updates arriving during the backfill. Plan a write pause, dual-write/CDC catch-up or equivalent reconciliation, verify counts and representative queries, then switch and monitor. An alias swap alone does not guarantee zero data loss.

**Read-after-write:** `refresh=wait_for` normally waits for a refresh to make the write searchable; `refresh=true` forces a refresh and frequent use can create inefficient small segments. With automatic refresh disabled, `wait_for` can wait indefinitely until a refresh occurs; listener saturation can itself force a refresh. Both options trade throughput/latency for visibility; direct document retrieval has different semantics from search. For faceted search, `post_filter` filters hits after aggregations so facets can describe the broader query result; put a filter in the query when aggregations should also be restricted.

### 3a. Analyzer, deep dive — the pipeline, not just the word

An analyzer is a **3-stage pipeline** that only runs on `text` fields. The easy way to recall it: *"analyzers tokenize, normalizers don't."*

```
                char_filter(s)          tokenizer            token filter(s)
"The Quick-Foxes!"  ──────────────►  "The Quick-Foxes!"  ──────────►  ["The","Quick","Foxes"]  ──────────►  ["the","quick","foxes"]
                 (strip/replace           (split into                  (lowercase)
                  raw characters)          words/tokens)
```

1. **`char_filter`** — operates on the raw string *before* tokenization (e.g. `html_strip` to remove `<b>` tags, or a `mapping` char filter to turn `:)` into `happy`).
2. **`tokenizer`** — exactly one per analyzer, splits the string into initial tokens (the `standard` tokenizer uses Unicode text-segmentation rules); subsequent token filters may change their count.
3. **`token filter(s)`** — operate on the token *stream* (lowercase, `stop` to drop "the"/"a", `stemmer` to reduce "running"→"run", `synonym` to expand "car"→"car, automobile").

The default `standard` analyzer produces `["the", "quick", "foxes"]`: it lowercases but does **not** stem, and its stopword filter is disabled by default. A `match` query for `quick` can find the indexed token; don't assume `fox` matches `foxes` without an appropriate stemming configuration. Search analysis defaults to the field's analyzer, but can deliberately differ via `search_analyzer`; test both sides with `_analyze`.

Custom analyzer example, annotated stage-by-stage:

```json
PUT /products
{
  "settings": {
    "analysis": {
      "filter": {
        "autocomplete_filter": {
          "type": "edge_ngram",
          "min_gram": 1,
          "max_gram": 20
        }
      },
      "analyzer": {
        "autocomplete": {
          "type": "custom",
          "tokenizer": "standard",          // stage 2: split into words
          "filter": [
            "lowercase",                     // stage 3a: normalize case
            "autocomplete_filter"            // stage 3b: expand "quick" -> q, qu, qui, quic, quick
          ]
        }
      }
    }
  }
}
```

**Recall trick:** char filter = *"fix the raw text"*, tokenizer = *"cut it into pieces"*, token filter = *"process the tokens"*. Token filters can also change the count: stop filters remove tokens and synonym or n-gram filters can add them.

**`analyzer` vs `search_analyzer` — a common trip-up with n-gram analyzers like the one above.** By default the same analyzer runs at index time and query time, but a mapping can override the query-time one with `search_analyzer`. For an edge-n-gram autocomplete field, you *want* this override: index time still expands `"quick"` into grams (`q`, `qu`, `qui`, ...) so partial prefixes match, but query time should use a plain `standard` analyzer so the typed search term is tokenized normally, not re-expanded into grams — using the n-gram analyzer on both sides would make a search for `"quick"` also match on unrelated short fragments it shouldn't.

### 3b. Normalizer, deep dive — the same idea, minus the cutting

A normalizer is for `keyword` fields, which are never tokenized (that's the entire point of `keyword` — exact match, one token in, one token out). A normalizer runs **char_filter + token filter only — no tokenizer stage**, so the string stays a single token but gets simple char-level cleanup applied:

```
                char_filter(s)                 token filter(s)                  (no tokenizer —
"Nitesh GUPTA"  ──────────────►  "Nitesh GUPTA"  ──────────►  "nitesh gupta"        stays ONE token)
```

```json
PUT /users
{
  "settings": {
    "analysis": {
      "normalizer": {
        "lowercase_normalizer": {
          "type": "custom",
          "char_filter": [],
          "filter": ["lowercase", "asciifolding"]   // e.g. "GUPTA" -> "gupta", "Café" -> "cafe"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "username": {
        "type": "keyword",
        "normalizer": "lowercase_normalizer"
      }
    }
  }
}
```

Without the normalizer, `term` query `"GUPTA"` would miss a stored value of `"Gupta"` — `keyword` fields store the raw string verbatim by default, so `"Gupta" != "GUPTA"` byte-for-byte. The normalizer makes both index-time storage *and* query-time comparison go through the same lowercase transform, so the exact-match query becomes case-insensitive without turning the field into a tokenized `text` field (you'd still lose the ability to sort/aggregate/filter on it exactly if you went that route).

**One-line distinction to say out loud in an interview:** *"Analyzer = tokenizer + filters, for `text`, multi-token output. Normalizer = filters only, no tokenizer, for `keyword`, single-token output — same family of char/token filters, just without the splitting stage."*

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

**Field mapping tuning, a concrete snippet:** these are all declared per field in the index mapping, not query-time options — so they only take effect at index-creation time (or via reindex for an existing index). A typical "don't pay for what you don't use" mapping:

```json
PUT /orders
{
  "mappings": {
    "properties": {
      "order_id":        { "type": "keyword" },
      "internal_debug_blob": {
        "type": "object",
        "enabled": false
      },
      "warehouse_barcode": {
        "type": "keyword",
        "index": false
      },
      "product_name": {
        "type": "text",
        "norms": false
      },
      "customer_name": { "type": "text" },
      "sku":           { "type": "keyword" },
      "full_text_search": {
        "type": "text"
      }
    }
  }
}
```

What each knob is actually doing:
- **`"index": false`** (on `warehouse_barcode`) — the field is stored in `_source` and can be returned/retrieved, but Lucene never builds an inverted index entry for it, so you cannot query/filter/aggregate on it. Use this for fields you only ever display, never search (e.g. an internal reference code you show on a receipt but never filter orders by).
- **`"enabled": false`** (on `internal_debug_blob`, an `object`/nested structure) — ES stores the raw JSON in `_source` but doesn't parse or index *any* sub-fields underneath it at all, not even implicitly. This is the right call for opaque blobs (raw webhook payloads, audit dumps) you need to retrieve verbatim but never search inside.
- **`"norms": false`** (on `product_name`, a `text` field) — norms are the per-field, per-document length-normalization factors BM25 uses to compute relevance *score*. Disabling them saves index size/memory but makes the field unscoreable for relevance ranking — fine for a field you only ever use in a filter context (`term`/`match` inside a `filter` clause, which doesn't score) but never in a scored, ranked full-text query.
- **`_all` / catch-all field** — this was a single synthetic field (pre-7.x) that concatenated every field's value so you could search across the whole document with one query. It's removed in modern versions; the explicit replacement is `copy_to`, where you opt specific fields into a dedicated combined field instead of indexing *everything* into one blob: `"customer_name": { "type": "text", "copy_to": "full_text_search" }`. The difference matters for an interview: `_all` was indiscriminate (and expensive) by default; `copy_to` is an explicit, cheaper, per-field choice.

The common thread across all three (`index: false`, `enabled: false`, `norms: false`): every field ES fully indexes/analyzes/scores costs *write-time* CPU and *disk*, whether or not you ever query it that way — so the tuning instinct is to ask "do I filter on this?", "do I search inside this?", "do I rank by this?" per field, and turn off exactly the capabilities you don't need.

**Interview-ready synthesis, one sentence per lever category:** throughput problems are solved by batching writes and relaxing replication during the load; search-latency problems are solved by not indexing/scoring fields you don't need and by measuring with the Profile API before guessing; capacity problems are solved by sizing shards and thread pools to the actual workload up front, because both are expensive to change after the fact.

**Bulk API, the SQL analogy that makes the reasoning stick:** the `_bulk` endpoint is the same idea as a SQL batch update/insert — one network round trip carrying many operations (index/create/update/delete, mixed freely in one request) instead of a round trip per row. The saving isn't just network latency; each request on the ES side also pays fixed overhead (parsing, routing to the right shard, refresh/translog bookkeeping) that amortizes across the whole batch instead of being paid per document. The batch-size lever is the same tradeoff as SQL batching too — too small and per-request overhead still dominates, too large and a single oversized bulk request risks tripping the circuit breaker (`circuit_breaking_exception`) or timing out, so it's tuned empirically (commonly starting around a few MB or a few thousand documents per batch) rather than maximized blindly.

## 7. Query DSL & aggregations — the shapes you'll actually be asked to write

These are the query types that come up most in interviews, each with a runnable snippet. The organizing question for all of them: **"does this clause need to score, or just filter?"** — that single distinction drives whether something belongs in `query`/`must`/`should` (scored) or `filter`/`must_not` (not scored, cacheable).

**`term` — exact match, no analysis.** Use on `keyword` fields only; running `term` against an analyzed `text` field is a classic interview gotcha because the field was tokenized/lowercased at index time, so an exact-case `term` match silently returns nothing.
```json
GET /employees/_search
{
  "query": {
    "term": { "gender.keyword": "MALE" }
  }
}
```

**`match` — analyzed, scored full-text search.** The query string itself is analyzed the same way the field was at index time (lowercased, tokenized), so this is the right choice for free-text fields.
```json
GET /employees/_search
{
  "query": {
    "match": { "designation": "senior software engineer" }
  },
  "sort": [{ "joining_date": "desc" }]
}
```
Sorting on a `text` field directly fails (`text` fields aren't sort-ready — they're tokenized, so there's no single stable value to sort by) — this is why the project's mapping keeps a `keyword` sub-field (a "multi-field": `"designation": {"type":"text","fields":{"raw":{"type":"keyword"}}}`) purely so you can `sort` on `designation.raw` while still full-text-searching on `designation`.

**`bool` — combining clauses, the one query shape you'll use constantly.**
```json
GET /employees/_search
{
  "query": {
    "bool": {
      "must":     [{ "match": { "designation": "engineer" } }],
      "filter":   [{ "term":  { "department.keyword": "Engineering" } }],
      "must_not": [{ "term":  { "marital_status.keyword": "DIVORCED" } }],
      "should":   [{ "term":  { "location.keyword": "Bangalore" } }]
    }
  }
}
```
`must`/`should` affect the relevance score; `filter`/`must_not` don't — they're pure yes/no and ES can cache them, so pushing anything that doesn't need scoring into `filter` is both a correctness and a performance choice.

**`range` — numeric/date bounds.**
```json
GET /employees/_search
{
  "query": {
    "range": { "joining_date": { "gte": "2015-01-01", "lte": "2020-12-31" } }
  }
}
```

Same query shape works identically on a plain numeric field — e.g. age between 8 and 12 inclusive:

```json
GET /people/_search
{
  "query": {
    "bool": {
      "filter": {
        "range": { "age": { "gte": 8, "lte": 12 } }
      }
    }
  }
}
```

`gte`/`lte` are inclusive, `gt`/`lt` are exclusive — same four operators regardless of field type (numeric, date, or even `ip`). Wrapped in `bool.filter` here rather than bare `query.range` or `bool.must` because a range bound on its own carries no relevance signal — filter context skips scoring and is cacheable, matching the "exact criterion, not a ranked match" nature of the query.

**`nested` query — querying inside a `nested` field without flattening cross-matches.** Needed whenever the field was mapped `"type": "nested"` (recall §5: `projects` is `nested` because each project needs to be matched as a self-contained unit, not as independently-matching arrays of names/roles).
```json
GET /employees/_search
{
  "query": {
    "nested": {
      "path": "projects",
      "query": {
        "bool": {
          "must": [
            { "match": { "projects.name": "Payments Platform" } },
            { "match": { "projects.role": "Lead" } }
          ]
        }
      },
      "score_mode": "max",
      "inner_hits": {}
    }
  }
}
```
Without `nested`, a plain `bool`/`match` against `projects.name` and `projects.role` would match an employee if *any* project had the right name and *any* (possibly different) project had the right role — the classic "cross-object match" bug `nested` exists to prevent.

**Making the bug concrete, a worked example.** Say one employee document has two projects:
```json
{
  "name": "Priya",
  "projects": [
    { "name": "Payments Platform", "role": "Contributor" },
    { "name": "Search Revamp",     "role": "Lead" }
  ]
}
```
Priya is a *Contributor* on Payments Platform and *Lead* on a different project (Search Revamp) — she is **not** the Lead of Payments Platform.

If `projects` were mapped `"type": "object"` (the default) instead of `"nested"`, Lucene internally flattens arrays of objects into parallel arrays per field — `projects.name: ["Payments Platform", "Search Revamp"]` and `projects.role: ["Contributor", "Lead"]` — with no record of which name paired with which role. A plain query like:
```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "projects.name": "Payments Platform" } },
        { "match": { "projects.role": "Lead" } }
      ]
    }
  }
}
```
would **wrongly match Priya**: `"Payments Platform"` is present *somewhere* in `projects.name`, and `"Lead"` is present *somewhere* in `projects.role` — the query has no way to check they came from the same array entry. That's the cross-object match bug.

`"type": "nested"` fixes this by indexing each array entry as its own hidden Lucene document, so `name` and `role` stay bound together per entry. The same `nested` query shown above runs its inner `bool` against one entry at a time — against entry 1 (`name: "Payments Platform"`, `role: "Contributor"`) the `role: "Lead"` clause fails, and against entry 2 (`name: "Search Revamp"`, `role: "Lead"`) the `name` clause fails — so no single entry satisfies both clauses, and Priya is correctly excluded. Only an employee who is genuinely the Lead *of* Payments Platform (both fields matching within the same array entry) would match.

**`multi_match` / `simple_query_string` — one query string across several fields.**
```json
GET /employees/_search
{
  "query": {
    "multi_match": {
      "query": "senior engineer",
      "fields": ["designation^2", "department"]
    }
  }
}
```
The `^2` boosts `designation` matches to twice the relevance weight of a `department` match in the same query — useful when one field is a stronger relevance signal than another.

**Scroll API — deep pagination beyond `from`/`size`.** `from`/`size` breaks down past ~10,000 results (the `index.max_result_window` guard) because ES would have to rank and discard everything before `from` on every single page request. Scroll instead takes one consistent snapshot and hands back a cursor.
```json
POST /employees/_search?scroll=1m
{
  "size": 500,
  "query": { "match_all": {} }
}

POST /_search/scroll
{
  "scroll": "1m",
  "scroll_id": "<scroll_id from the previous response>"
}
```
The tradeoff to know for interviews: scroll holds resources open server-side for its whole duration (point-in-time view of the index), so it's meant for bulk export/reindex jobs, not live user-facing pagination — `search_after` is the modern replacement for user-facing deep pagination because it's stateless (no server-side cursor to keep alive).

### 7a. Case study — paginated search starts returning duplicate results

**The scenario:** a user-facing feature pages through search results with plain `from`/`size` (page 1 = `from:0,size:20`, page 2 = `from:20,size:20`, ...), sorted by `updated_at`. After enough traffic, users start seeing the same record appear on two consecutive pages.

**Root cause #1 — concurrent writes reorder the sort key mid-pagination.** `from`/`size` (and even `search_after`) re-runs the full query on every page call; there's no snapshot in between. If a document's `updated_at` changes between page 1 and page 2 (someone updates that record while the user is still reading page 1), it can shift position in the sort order and get pushed from "already shown" into the next page's window — the user sees it twice. This is a **consistency**, not a bug — ES isn't a transactional system and gives no cross-request pagination snapshot by default.
- Fix options: use the **Point-in-Time (PIT) API** + `search_after` for a frozen, consistent view across the whole pagination session (`POST /index/_pit?keep_alive=1m`, then pass `pit.id` on every page request); or accept the tradeoff and dedupe client-side by ID across pages for feeds where staleness is tolerable.

**Root cause #2 — tied scores reshuffle across shards on every call.** When many documents have the **identical relevance score** (common with `match_all`, or filter-only queries where nothing contributes to scoring), ES's only real tiebreaker is `_doc` order, which is **per-shard internal order** — and a distributed index spreads data across multiple shards. Two identical `from`/`size` requests can come back with hits re-interleaved differently shard-to-shard, which looks like duplicates/missing rows across pages even with nothing changing in the data.
```json
GET /employees/_search?preference=user-session-abc123
{
  "size": 20,
  "from": 20,
  "sort": [{ "updated_at": "desc" }]
}
```
Setting **`preference`** to the same custom string (e.g. a session/request ID) on every page of one pagination session pins all of that session's requests to the **same set of shard copies** in the **same order**, removing the shard-routing-driven nondeterminism. It doesn't fix root cause #1 (concurrent writes) — it only makes the *shard-routing* part of result ordering deterministic across calls.

**Related — scores and sort don't mix for free.** By default, specifying any explicit `sort` clause **disables score computation** (ES skips it as a performance optimization, since you asked it to order by something else). If you still need the relevance score visible/available alongside a custom sort (e.g. for debugging or display), opt back in explicitly:
```json
GET /employees/_search
{
  "track_scores": true,
  "sort": [{ "updated_at": "desc" }],
  "query": { "match": { "title": "engineer" } }
}
```
Without `track_scores: true`, `_score` comes back as `null` whenever a sort is present.

**Debugging tool — Explain API.** When a document unexpectedly does or doesn't show up in results (including these duplicate/missing-row pagination symptoms), the Explain API shows exactly how the scoring/matching decision was made for that one document against that one query:
```
GET /employees/_explain/1042
{
  "query": { "match": { "title": "engineer" } }
}
```
It returns a breakdown of every clause that contributed (or didn't) to the match and score — the practical "why did/didn't this doc match" tool, as opposed to guessing from the aggregate result set.

**Resolution — what actually shipped.** Two independent fixes, not one: (1) switched the pagination mechanism from `from`/`size` to **PIT + `search_after`**, so every page of a session reads off one consistent snapshot instead of re-querying the live index each time — this closed root cause #1. (2) added a stable `preference` value (the session ID already generated per pagination session) to every page request, so shard routing stopped reshuffling tied-score results — this closed root cause #2. `track_scores` and the Explain API weren't fixes in themselves; they were how the "same score across many docs" theory got confirmed before reaching for `preference` as the fix — worth saying out loud in an interview to show the diagnosis came before the patch, not a guess.

**Aggregations — computing stats alongside the query, not after it.** The faceted-search row in §5 and these buckets are the same idea: one request, both the hits and the computed stats over the full matching set.
```json
GET /employees/_search
{
  "size": 0,
  "query": { "term": { "department.keyword": "Engineering" } },
  "aggs": {
    "distinct_designations": { "cardinality": { "field": "designation.keyword" } },
    "salary_stats": {
      "stats": { "field": "salary" }
    },
    "salary_p95": {
      "percentiles": { "field": "salary", "percents": [95] }
    }
  }
}
```
`size: 0` is the tell that this request only cares about aggregation results, not the matching documents themselves — skipping hit retrieval/scoring entirely saves real work when you only need the numbers. `cardinality` is approximate (HyperLogLog++ under the hood, not an exact `COUNT(DISTINCT ...)`) — the accuracy/memory tradeoff is itself a common follow-up question.

*(Custom analyzers and normalizers are covered in depth in §3a/§3b — not repeated here.)*
