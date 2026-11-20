# Caching and Redis Notes

Reviewed: November 19, 2026. Source: the five-page Caching PDF, covering in-process vs. distributed caching, Redis data types, Spring Cache abstraction, and Redis internals (replication, Sentinel, Cluster, persistence, eviction).

This is a scoped editorial conversion, not a verbatim transcript. In real Spring Boot teams, Redis is almost always consumed behind an abstraction — Spring Cache annotations or Spring Data Redis — not operated directly. Deep Redis Cluster/Sentinel topology internals are trimmed to brief awareness notes; app-level caching decisions get full depth since those are what you actually design and defend in an interview.

Related: [Spring Data](../spring/Spring-Data-Notes.md) (transactions, repositories), [Boot vs. Cloud](../spring/Spring-Boot-Notes.md#7-boot-vs-cloud) (where a dedicated cache/service mesh fits a microservice stack).

## 1. In-process vs. distributed cache

| | In-process (Caffeine, Guava, ConcurrentHashMap) | Distributed (Redis, Memcached) |
|---|---|---|
| **Latency** | Fastest — no network hop | Extra network round trip, but still far cheaper than a DB/external call |
| **Scope** | Local to one JVM instance | Shared across all instances/pods |
| **Consistency across replicas** | None — each pod has its own stale copy after a write | Single shared view (subject to its own replication lag) |
| **Capacity** | Bounded by heap on one instance | Bounded by the cache cluster, independent of app heap |
| **Survives restart/redeploy** | No | Yes (if persistence enabled) |
| **Failure mode** | Cache loss is local; other pods unaffected | A shared cache outage/latency spike affects every pod at once |

**The interview trap:** "just add a cache" ignores this trade-off. A rolling deployment with an in-process cache gives every pod a different, eventually-stale view of the same key until each pod's TTL expires or it's evicted — that's fine for read-heavy reference data, not fine for anything requiring read-your-writes consistency across instances. Distributed caching fixes the consistency gap but adds a network dependency and a new failure mode: what does the app do when Redis itself is slow or down? (Fail open to DB, fail closed, or circuit-break — decide explicitly, don't let `RedisConnectionFailureException` propagate as a 500 for a GET that would've worked fine straight from the DB.)

**Two-level caching** (L1 in-process + L2 distributed) is a legitimate real pattern — Caffeine as a short-TTL L1 in front of Redis as L2 — to shave the network hop for very hot keys, accepting a short window of cross-pod staleness on just those keys.

## 2. Redis data types — pick by access pattern, not by habit

| Type | Use when | Example |
|---|---|---|
| **String** | Simple key -> value, counters (`INCR`), session blobs | Cached DTO serialized as JSON; rate-limit counter |
| **Hash** | Group related fields under one key, update one field without re-sending the whole object | User profile fields (`name`, `email`, `lastLogin`) under `user:123` |
| **List** | Ordered, push/pop from either end | Simple job queue, recent-activity feed (capped) |
| **Set** | Unique membership, set algebra (union/intersect/diff) | Tags on a post; "users currently online" |
| **Sorted Set (ZSet)** | Ranked data, range queries by score | Leaderboards, rate-limiting sliding windows, delayed-job schedules (score = execute-at timestamp) |
| **Bitmap** | Dense boolean flags at huge key counts, memory-cheap | Daily active-user tracking (`SETBIT` per user id per day) |
| **HyperLogLog** | Approximate distinct-count at fixed, tiny memory | "Unique visitors today" when exact count isn't required |

**Why this matters beyond definitions:** choosing String when you needed a Hash means re-serializing and re-sending the *whole* object for a one-field update, and losing the ability to `HINCRBY` a single counter field atomically. Choosing a List for a leaderboard means no O(log N) ranked range query — you'd have to pull everything and sort in the app. The data type is a design decision, not a syntax choice.

## 3. Spring Cache abstraction

Spring Cache is a declarative, provider-agnostic abstraction — the same annotations work whether the backing `CacheManager` is `ConcurrentMapCacheManager` (in-process, tests), Caffeine, or Redis (via `RedisCacheManager`/Spring Data Redis). Swapping providers is a configuration change, not an annotation rewrite.

| Annotation | Effect |
|---|---|
| `@Cacheable` | Check cache first; on miss, run the method and store the result; on hit, skip the method entirely |
| `@CachePut` | Always run the method, then update the cache with the result (use for writes that should also refresh the cache) |
| `@CacheEvict` | Remove an entry (or `allEntries = true` to clear the whole cache) after the method runs |
| `@Caching` | Combine multiple cache operations on one method (e.g., evict one cache and put another) |
| `@CacheConfig` | Class-level default `cacheNames`, so each method doesn't repeat it |

```java
@Cacheable(cacheNames = "products", key = "#id")
public Product findById(Long id) { ... }

@CachePut(cacheNames = "products", key = "#product.id")
public Product update(Product product) { ... }

@CacheEvict(cacheNames = "products", key = "#id")
public void delete(Long id) { ... }
```

**Traps that come up in interviews:**

- **Self-invocation bypasses the cache**, same root cause as `@Transactional` — these are proxy-based AOP. Calling `this.findById(id)` from another method in the same bean skips the proxy, so no cache check happens.
- **Key design matters.** The default key generator combines all method args; an overload with the same effective lookup but different parameter order/count silently gets a different key. Use explicit `key = "#id"` (SpEL) for anything non-trivial.
- **`@Cacheable` on a method that can legitimately return `null`** needs `unless = "#result == null"` or you'll permanently cache the miss (depending on provider null-handling) and never retry.
- **Exceptions are not cached** by default — a failed call doesn't populate the entry, so the next call retries the method. That's usually what you want, but it also means a failing downstream dependency gets hammered repeatedly if callers retry in a tight loop; pair with a circuit breaker if that's a risk.

## 4. Spring Cache abstraction vs. Spring Data Redis — use both, for different jobs

These solve different problems and are commonly used **together**, not as alternatives:

- **Spring Cache abstraction** (`@Cacheable` etc.) is for the "cache the result of this method call" pattern — declarative, works with any provider, minimal code.
- **Spring Data Redis** (`RedisTemplate`/`ReactiveRedisTemplate`, repositories) is for when Redis **is** the primary data store or you need direct access to its data structures — ZSet-based leaderboards, pub/sub, distributed locks, rate limiters. You can't express "give me the top 10 by score" through `@Cacheable`; that needs direct `RedisTemplate.opsForZSet()` access.

**Practical rule of thumb:** if you're caching the output of a DB query/computation, reach for `@Cacheable`. If Redis itself holds data with structure you need to query (ranked, set membership, counters), use `RedisTemplate` directly.

## 5. Eviction policies and cache patterns

**`maxmemory-policy`** (what Redis evicts once `maxmemory` is hit) — commonly asked, worth knowing cold:

| Policy | Behavior |
|---|---|
| `noeviction` | Reject writes once full; reads still work. Default — surprises people in production. |
| `allkeys-lru` | Evict least-recently-used key across the whole keyspace |
| `allkeys-lfu` | Evict least-frequently-used key across the whole keyspace |
| `volatile-lru` / `volatile-lfu` | Same, but only among keys with a TTL set |
| `allkeys-random` / `volatile-random` | Evict a random key (cheap, less predictable) |
| `volatile-ttl` | Evict the key with the nearest expiry first |

Pick `volatile-*` policies when some keys must never be evicted (e.g., session data vs. disposable query-result cache sharing one Redis instance) — set a TTL only on the evictable ones.

**Cache-aside (lazy loading)** — the dominant pattern with `@Cacheable`: app checks cache, falls back to DB on miss, writes result back. Simple, but the first request after an eviction always pays full DB latency ("cold cache" / thundering-herd risk if many requests miss simultaneously — mitigate with request coalescing or a short lock around the DB fill).

**Write-through** — write goes to cache and DB together (or cache fronts the DB entirely); reads are always a cache hit after the first write. More consistency guarantee, more write-path complexity.

**Stale data and invalidation** are the two hard problems: TTL alone trades staleness for simplicity (accept data can be up to TTL seconds old); explicit `@CacheEvict` on writes gives freshness but requires every write path to remember to evict — miss one and you serve stale data indefinitely.

## 6. Replication, persistence and cluster — awareness level

Redis offers both durability options; which one matters depends on what's cached:

- **RDB** (point-in-time snapshot) — compact, fast restart, but can lose writes since the last snapshot.
- **AOF** (append-only log of writes) — more durable, replayable, larger file, slower restart.
- For most **caching** use cases (not primary-store use cases), durability is a secondary concern — a cold cache after a restart is a performance hit, not data loss, since the source of truth is the DB. Durability matters far more when Redis holds data with no other system of record (session store, rate-limit counters you can't afford to reset).

**Replication/Sentinel/Cluster** — in practice you consume these as managed infrastructure (Azure Cache for Redis, AWS ElastiCache) configured declaratively, not hand-rolled:

- **Replication** gives read replicas and failover; **Sentinel** adds automatic failover/monitoring for non-clustered deployments; **Cluster** adds horizontal sharding across hash slots for datasets/throughput too large for one node.
- The one practical consequence worth knowing: replication is asynchronous by default, so a failover can lose the last few writes (and a client reading from a replica can see slightly stale data). If an interviewer pushes into hash-slot math or cluster bus ports, that's infra/ops depth beyond what most app-dev roles need — say so and pivot back to how the app handles a Redis connection failure, which is the part you actually own.

## 7. Interview questions with answers and scenarios

### 7.1 Why use Redis instead of just caching in the application's memory?

An in-process cache is per-JVM: after a write, other pods keep serving the old value from their own copy until TTL/eviction catches up, and a redeploy wipes it entirely. Redis gives one shared, consistent-enough view across every pod, and survives individual pod restarts.

### 7.2 `@Cacheable` isn't working when called from another method in the same class — why?

Self-invocation. `@Cacheable` is proxy-based AOP, same as `@Transactional`; calling a sibling method via `this.method()` bypasses the proxy entirely, so the cache check never happens. Fix by calling through the proxy (self-injection, `AopContext.currentProxy()`, or restructuring into a separate bean).

### 7.3 A cache entry still shows old data minutes after an update. What do you check first?

In order: (1) does the write path actually call `@CachePut`/`@CacheEvict`, or did someone add a new update path that forgot to? (2) is the cache key generated the same way on read and write — a key mismatch means the evict silently misses the entry the read path is actually using; (3) is there a second cache layer (L1 in-process in front of Redis) with its own, longer TTL.

### 7.4 When would you choose Spring Data Redis's `RedisTemplate` over `@Cacheable`?

When Redis needs to do more than store a method's return value — ranked queries (`ZSet` leaderboard), atomic counters (`INCR` for rate limiting), pub/sub, or a distributed lock. `@Cacheable` only expresses "cache this method call"; it can't express "give me the top 10 by score."

### 7.5 Your app's Redis cluster goes down. What happens to the app?

Depends entirely on how the cache-aside fallback is written. If `@Cacheable` wraps a method that queries the DB, a `RedisConnectionFailureException` from the cache layer should not take down the whole request — either let Spring Cache's error handling fail open to the underlying method (the default behavior for most Spring Boot auto-configured `CacheErrorHandler`), or implement a custom `CacheErrorHandler` that logs and falls through to the DB rather than propagating. The DB then absorbs full load with no cache cushioning — size connection pools and expect latency to rise, but the app should still serve correct (just slower) responses, not 500s.

### 7.6 Why is `noeviction` risky as a default `maxmemory-policy`?

Once the cache hits `maxmemory`, every write-type command starts failing (reads still work). If Redis is also used for anything beyond pure disposable caching — e.g., session storage or counters sharing the same instance — that's a silent outage for new writes, not a performance-only degradation. Pick an explicit eviction policy matched to which keys are safe to lose.
