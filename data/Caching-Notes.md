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

**The interview trap:** "just add a cache" ignores this trade-off. A rolling deployment with an in-process cache gives every pod a potentially different stale view until its TTL expires or it's evicted — unsuitable for cross-instance read-your-writes without more coordination. A shared cache reduces divergent copies but does not by itself make database writes and cache updates atomic. It also adds a network dependency: when Redis is slow or down, decide explicitly whether to fall back to the DB, fail closed or circuit-break, considering DB capacity and correctness.

**Two-level caching** (L1 in-process + L2 distributed) is a legitimate real pattern — Caffeine as a short-TTL L1 in front of Redis as L2 — to shave the network hop for very hot keys, accepting a short window of cross-pod staleness on just those keys.

**Write choices under load:** write-through updates the backing store as part of the write path, trading latency for a clearer persistence boundary. Write-behind acknowledges a cache update before an asynchronous persistence step: it can absorb bursts, but a crash, lost queue or reordered writes can lose or corrupt acknowledged updates unless durability, ordering, retries and reconciliation are designed explicitly. Write-around writes directly to the store and avoids polluting the cache with rarely reread data; invalidate/update any existing cached value or a later read can still be stale.

**Freshness follow-up:** TTL is an expiry policy, not an absolute end-to-end staleness guarantee: stale source reads, update races or multiple cache layers can extend the observed window. An HTTP `ETag` with `If-None-Match` validates a representation and can yield `304`; it is not itself a cache invalidation event or a guarantee that every intermediary contacts the origin on each request.

**Stacking two `@Cacheable` annotations for L1 + L2 (Ehcache + Redis) — yes, order matters, and there's a gap.** `@Cacheable` isn't `@Repeatable`, so two of them on one method need `@Caching`, each pointed at a different `cacheManager`:
```java
@Caching(cacheable = {
    @Cacheable(cacheNames = "products-l1", cacheManager = "ehCacheManager", key = "#id"),
    @Cacheable(cacheNames = "products-l2", cacheManager = "redisCacheManager", key = "#id")
})
public Product findById(Long id) { ... }
```
On a **read**, Spring checks the caches in the order the `@Cacheable` entries are declared — L1 (Ehcache) first, then L2 (Redis) — and returns on the first hit, short-circuiting the rest. So yes, order matters: list the fastest/local cache first, or every call pays the Redis round trip even when a hit is sitting one line later in declaration order. On a full **miss** (both L1 and L2 miss), the method runs once and the result is written into *both* caches.

**The gap this doesn't cover:** if L1 misses but L2 hits — the common case right after a redeploy wipes the local Ehcache but Redis still has the value — Spring returns the L2 value *without writing it back into L1*. Write-back to earlier-listed caches only happens when the underlying method actually executes (a full miss), not when a later cache serves the hit. So until that key is naturally re-populated (next full miss) or evicted from Redis, every request on that pod keeps paying the Redis network hop for it — L1 never gets "warmed" from an L2 hit under plain `@Caching`. If true read-through promotion matters, the fix is a custom composite `org.springframework.cache.Cache` that wraps both delegates and performs the L1 write-back itself inside `get()` (registered as one `CacheManager`, so the method only needs a single `@Cacheable`), rather than relying on stacked annotations.

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

**`@Caching` — why it exists and when you actually reach for it.** `@Cacheable`, `@CachePut`, and `@CacheEvict` are **not** `@Repeatable`, so you can't stack two of the *same* annotation on one method directly. `@Caching` is the container annotation that groups multiple `cacheable`/`put`/`evict` operations — same type or mixed — onto a single method:

```java
@Caching(
    put = {
        @CachePut(cacheNames = "products", key = "#product.id")
    },
    evict = {
        @CacheEvict(cacheNames = "products-by-category", key = "#product.categoryId"),
        @CacheEvict(cacheNames = "products-search-results", allEntries = true)
    }
)
public Product update(Product product) { ... }
```

Two distinct use cases show up in practice:

- **Mixed operations, one method** (the classic case): an `update()` needs to refresh its own cache entry (`@CachePut`) *and* invalidate derived/secondary caches that are now stale (a category listing, a search-results cache) via `@CacheEvict` — different cache names, different semantics, can't express that with a single annotation.
- **Same operation repeated across tiers**, e.g. the L1+L2 `@Cacheable` stacking from §1 above — multiple `@Cacheable` entries pointed at different `cacheManager`s so one method populates/reads both an in-process and a distributed cache.

Without `@Caching`, the workaround is a separate helper method per cache operation, which is clunkier and splits what's logically one unit of work across the call stack.

**Traps that come up in interviews:**

- **Self-invocation bypasses the cache**, same root cause as `@Transactional` — these are proxy-based AOP. Calling `this.findById(id)` from another method in the same bean skips the proxy, so no cache check happens.
- **Key design matters.** The default key generator combines all method args; an overload with the same effective lookup but different parameter order/count silently gets a different key. Use explicit `key = "#id"` (SpEL) for anything non-trivial.
- **A `null` *key* is not the same as a `null` *value*.** If an explicit expression such as `key = "#id"` evaluates to null, Spring's cache interceptor rejects the key rather than treating it as a miss. Validate the argument or use a condition such as `condition = "#id != null"`. By contrast, the default `SimpleKeyGenerator` wraps a single null argument in a non-null `SimpleKey`; it does not produce a null key. Null *results* are a separate provider/configuration decision.
- **`@Cacheable` on a method that can return `null`:** if the provider and configuration allow caching nulls, a miss can remain cached until expiration or eviction. Use `unless = "#result == null"` when subsequent calls should retry instead; negative caching can be useful with an intentionally short lifetime.
- **Exceptions are not cached** by default — a failed call doesn't populate the entry, so the next call retries the method. That's usually what you want, but it also means a failing downstream dependency gets hammered repeatedly if callers retry in a tight loop; pair with a circuit breaker if that's a risk.

## 4. Spring Cache abstraction vs. Spring Data Redis — use both, for different jobs

These solve different problems and are commonly used **together**, not as alternatives:

- **Spring Cache abstraction** (`@Cacheable` etc.) is for the "cache the result of this method call" pattern — declarative, works with any provider, minimal code.
- **Spring Data Redis** (`RedisTemplate`/`ReactiveRedisTemplate`, repositories) is for when Redis **is** the primary data store or you need direct access to its data structures — ZSet-based leaderboards, pub/sub, distributed locks, rate limiters. You can't express "give me the top 10 by score" through `@Cacheable`; that needs direct `RedisTemplate.opsForZSet()` access.

**Practical rule of thumb:** if you're caching the output of a DB query/computation, reach for `@Cacheable`. If Redis itself holds data with structure you need to query (ranked, set membership, counters), use `RedisTemplate` directly.

**"Just annotate and the object gets serialized" — correct, but that's exactly the abstraction's blind spot.** `RedisCacheManager` stores every `@Cacheable` result as a single opaque blob (Redis `String` type) under a key like `cacheName::key`; it never touches Redis's native `Hash`/`List`/`Set`/`ZSet` structures. Concretely:
- **Serializer matters and isn't automatic by default.** Spring Boot's default value serializer is JDK Java serialization (`SerializationPair.fromSerializer(JdkSerializationRedisSerializer)`) — binary, not human-readable in `redis-cli`, and brittle across class changes. Most setups override it to `GenericJackson2JsonRedisSerializer` so the blob is JSON:
```java
@Bean
public RedisCacheConfiguration cacheConfiguration() {
    return RedisCacheConfiguration.defaultCacheConfig()
        .serializeValuesWith(SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer()))
        .entryTtl(Duration.ofMinutes(10));
}
```
- **No partial updates, no atomic ops.** Because the whole object is one serialized value, there's no way to bump a counter field or push onto a list inside it without read-serialize-deserialize-modify-write the entire blob yourself — the moment you need that, you're back to `RedisTemplate.opsForValue()/opsForHash()/opsForZSet()` directly, outside the annotation.
- **TTL is configured on the cache**, not directly by the annotation. A fixed `entryTtl(Duration)` applies the same duration to its entries; Spring Data Redis 3.2+ also supports `entryTtl(TtlFunction)` to calculate a duration per entry from its key and/or value.
- **`@CacheEvict(allEntries = true)` works but isn't free** — the default Redis cache writer uses `KEYS` and `DEL` for the cache prefix. For large keyspaces, configure a `SCAN` batch strategy where supported by your driver and deployment mode; neither approach is an O(1) table truncate.

So yes — for plain request/response caching you genuinely never need to think about Redis data types. The moment the ask becomes "rank these", "atomically increment", "intersect these sets", or "give me field-level TTL", that's the signal to drop to `RedisTemplate` for that specific need rather than fighting the annotation.

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

**Fixed TTL per cache is a simple choice.** To give session data no expiry and query results a five-minute expiry, register **two different cache names**, each with its own configuration, on the same `RedisCacheManager`:

```java
@Bean
public RedisCacheManager cacheManager(RedisConnectionFactory cf) {
    RedisCacheConfiguration noTtl = RedisCacheConfiguration.defaultCacheConfig(); // never expires
    RedisCacheConfiguration shortTtl = RedisCacheConfiguration.defaultCacheConfig()
        .entryTtl(Duration.ofMinutes(5));

    return RedisCacheManager.builder(cf)
        .withInitialCacheConfigurations(Map.of(
            "sessions", noTtl,       // keys: sessions::<id> — no TTL, never auto-expires
            "searchResults", shortTtl // keys: searchResults::<id> — 5 min TTL
        ))
        .build();
}
```

Both caches live in the same Redis instance; `sessions::*` keys have no TTL so `volatile-lru`/`volatile-ttl` skip them under memory pressure, while `searchResults::*` keys do have a TTL and are fair game. For different lifetimes **within one cache**, configure a `RedisCacheWriter.TtlFunction` through `entryTtl(...)` in Spring Data Redis 3.2+; direct `RedisTemplate` writes are another option when the application needs explicit Redis operations.

**Cache-aside (lazy loading)** — the dominant pattern with `@Cacheable`: app checks cache, falls back to DB on miss, writes result back. Simple, but the first request after an eviction always pays full DB latency ("cold cache" / thundering-herd risk if many requests miss simultaneously — mitigate with request coalescing or a short lock around the DB fill).

**Write-through** — the cache write path also updates the backing store before reporting success. This adds write latency and failure-handling complexity; entries can still expire or be evicted, so later reads are not guaranteed hits. Define how partial failures and concurrent writes are handled.

**Stale data and invalidation** are the two hard problems: TTL limits an individual entry's lifetime but does not alone bound end-to-end staleness (§1). Explicit `@CacheEvict` requires every write path to evict at the correct time; missed evictions or races can leave stale values until another eviction or expiry, potentially indefinitely without either.

## 6. Replication, persistence and cluster — operational reasoning

Redis offers both durability options; which one matters depends on what's cached:

- **RDB** (point-in-time snapshot) — compact, fast restart, but can lose writes since the last snapshot.
- **AOF** (append-only log of writes) — more durable, replayable, larger file, slower restart.
- **Defaults:** stock open-source Redis ships with **RDB enabled, AOF disabled**. The default `redis.conf` has `save` directives wired in out of the box (e.g. `save 3600 1`, `save 300 100`, `save 60 10000` — snapshot if N seconds passed and at least M keys changed), so an unconfigured Redis is already snapshotting periodically; `appendonly` defaults to `no`. Managed services differ: Azure Cache for Redis only exposes persistence (RDB or AOF, your choice) on **Premium+** tiers — Basic/Standard have none; AWS ElastiCache enables snapshotting by default on replication groups but it's tunable/disable-able per cluster.
- For most **caching** use cases (not primary-store use cases), durability is a secondary concern — a cold cache after a restart is a performance hit, not data loss, since the source of truth is the DB. Durability matters far more when Redis holds data with no other system of record (session store, rate-limit counters you can't afford to reset).

**Replication/Sentinel/Cluster** — in practice you consume these as managed infrastructure (Azure Cache for Redis, AWS ElastiCache) configured declaratively, not hand-rolled:

- **Replication** gives read replicas and failover; **Sentinel** adds automatic failover/monitoring for non-clustered deployments; **Cluster** adds horizontal sharding across hash slots for datasets/throughput too large for one node.
- Replication is asynchronous by default, so a failover can lose recent acknowledged writes; replica reads can be stale. Sentinel monitors a primary and coordinates failover, but isn't a sharding mechanism or an absolute guarantee against acknowledged-write loss. Clients must discover the new primary, reconnect and handle ambiguous in-flight writes safely.

**Cluster scenario:** one primary owns a subset of 16,384 hash slots. A primary failure affects keys in those slots until an eligible replica is promoted and clients refresh their routing; service behavior depends on cluster state and configuration. A hot key still lives on one shard, so adding shards alone won't split its traffic. A hash tag such as `{account:42}:balance` and `{account:42}:limits` deliberately places related keys in the same slot for supported multi-key operations, but overusing the same tag creates a hot slot. During resharding, cluster-aware clients must handle `MOVED`/`ASK` redirects.

**When the interviewer asks how to reduce round trips:** pipelining sends multiple commands without waiting for each response; it does not make them atomic. `MULTI`/`EXEC` executes queued commands together, and `WATCH` can detect concurrent changes before `EXEC`; Redis transactions do not roll back successful commands after a runtime error. A Lua script can perform a bounded check-and-update atomically on the server, but long scripts block other work and writes made before a script error are not automatically rolled back. In Cluster, multi-key transactions/scripts must respect same-slot restrictions.

**Pub/Sub versus Streams:** Pub/Sub is live, fire-and-forget delivery; a disconnected subscriber misses messages. Streams persist entries and support consumer groups, acknowledgments and replay while entries remain retained; consumers still need retry, idempotency and retention/lag monitoring. Neither should be assumed to provide exactly-once business effects.

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

**Correction to a common assumption:** the *actual* Spring default is **not** fail-open. Spring's out-of-the-box `CacheErrorHandler` is `SimpleCacheErrorHandler`, and its own Javadoc says it plainly — "a simple `CacheErrorHandler` that does not handle the exception at all, simply throwing it back at the client." So with no custom error handler configured (Spring Boot's cache auto-configuration doesn't supply one either), a `RedisConnectionFailureException` thrown while `@Cacheable` tries to `GET` from the cache propagates straight out of the aspect — the target method is **never invoked**, and the caller sees that exception (a 500, if nothing else catches it upstream). "Execute the underlying method" is the behavior you *want*, but you have to build it yourself.

To get fail-open-to-DB behavior, register a custom `CacheErrorHandler` bean that logs (so the Redis outage is visible — silently swallowing it would otherwise hide a real incident) and simply returns instead of rethrowing:

```java
@Configuration
public class CacheConfig implements CachingConfigurer {

    private static final Logger log = LoggerFactory.getLogger(CacheConfig.class);

    @Override
    public CacheErrorHandler errorHandler() {
        return new CacheErrorHandler() {
            @Override
            public void handleCacheGetError(RuntimeException ex, Cache cache, Object key) {
                log.warn("Cache GET failed for cache={} key={}, falling through to method", cache.getName(), key, ex);
                // no rethrow -> treated as a cache miss, method still runs
            }
            @Override
            public void handleCachePutError(RuntimeException ex, Cache cache, Object key, Object value) {
                log.warn("Cache PUT failed for cache={} key={}", cache.getName(), key, ex);
            }
            @Override
            public void handleCacheEvictError(RuntimeException ex, Cache cache, Object key) {
                log.warn("Cache EVICT failed for cache={} key={}", cache.getName(), key, ex);
            }
            @Override
            public void handleCacheClearError(RuntimeException ex, Cache cache) {
                log.warn("Cache CLEAR failed for cache={}", cache.getName(), ex);
            }
        };
    }
}
```

With that in place: the method runs against the DB on a cache GET failure (reads still succeed, just slower), writes/evicts are logged and dropped rather than crashing the write path, and — critically — none of it fails silently. The DB then absorbs full load with no cache cushioning, so size connection pools and expect latency to rise, but the app serves correct (just slower) responses instead of 500s. Without the logging, an ops team has no signal that Redis is down until latency/DB load alarms fire indirectly.

### 7.6 Why is `noeviction` risky as a default `maxmemory-policy`?

Once the cache hits `maxmemory`, every write-type command starts failing (reads still work). If Redis is also used for anything beyond pure disposable caching — e.g., session storage or counters sharing the same instance — that's a silent outage for new writes, not a performance-only degradation. Pick an explicit eviction policy matched to which keys are safe to lose.
