# Java Collections and Data Structures

This guide collects the Collections material that used to be deferred inside the core interview notes (section 10), consolidated with a supplied Collections/Data Structures study document covering `HashMap`/`HashSet` internals, `ArrayList` vs `LinkedList`, thread-safe collection choices, and related non-`java.util` data structures that come up in system-design-flavored interview questions. The core notes keep a pointer here; use this guide for the full explanations and examples.

## Contents

1. Collections framework overview
2. Choosing a collection by semantics
3. Comparable vs Comparator, and `binarySearch`
4. `ArrayList` vs `LinkedList`
5. Internal working of `HashMap`
6. Internal working of `HashSet`
7. `TreeSet`, `HashSet`, `LinkedHashSet` and the Red-Black tree underneath
8. `equals`/`hashCode` and why hash-based collections need them
9. Iterators: fail-fast vs fail-safe, `Iterator` vs `ListIterator`, removing during iteration
10. `NavigableMap`, `Map` vs `Hashtable`, and why `Map` doesn't extend `Collection`
11. Thread-safety: `HashMap` vs `Hashtable` vs `SynchronizedMap` vs `ConcurrentHashMap`
12. Nulls across collection implementations
13. Specialized map/set types: `EnumSet`, `IdentityHashMap`, `WeakHashMap`
14. Unmodifiable collections and the `Collections` utility class
15. Related data structures beyond `java.util`: Quad Tree and vector databases

## 1. Collections framework overview

A collections framework is a unified architecture for representing and manipulating collections. Every collections framework contains three things:

- **Interfaces** — abstract data types that represent collections, letting code manipulate a collection independently of its concrete representation. In object-oriented languages these interfaces generally form a hierarchy.
- **Implementations** — the concrete classes behind each interface; in essence, reusable data structures.
- **Algorithms** — methods such as searching and sorting that perform useful computations on objects implementing a collection interface. These algorithms are polymorphic: the same method works across different implementations of the appropriate interface.

Collections come in four basic flavors:

1. **Lists** — ordered things (classes implementing `List`).
2. **Sets** — unique things (classes implementing `Set`).
3. **Maps** — things with a unique ID (classes implementing `Map`).
4. **Queues** — things arranged by the order in which they are to be processed.

`Map` is deliberately not part of this `Collection` hierarchy — see section 10 for why.

## 2. Choosing a collection by semantics

The collections framework predates Java 5; Java 5 added generics, enhanced-for iteration and important concurrent utilities. Java 8 added stream integration and map convenience operations. Java 9 introduced `List.of`, `Set.of`, `Map.of`; Java 10 added `copyOf`; Java 21 added sequenced collection interfaces.

| Need | Starting point | Trade-off or failure mode |
| --- | --- | --- |
| Ordered items, indexed reads | `ArrayList` | Amortized constant-time append; middle insert/delete shifts elements |
| Unique values, no required encounter order | `HashSet` | Expected efficient membership; depends on correct equality/hashing |
| Key lookup, no required encounter order | `HashMap` | Expected constant-time basic operations with well-distributed hashes; not thread-safe |
| Stable insertion/access order | `LinkedHashMap`, `LinkedHashSet` | Extra linkage overhead; access-order maps are useful for cache policies |
| Sorted keys/range operations | `TreeMap`, `TreeSet` | Logarithmic basic operations; comparator determines key equivalence |
| Stack/queue/deque | `ArrayDeque` | No null elements; generally preferable to legacy `Stack` |
| Priority processing | `PriorityQueue` | Head follows priority; iteration is not sorted |
| Coordinated producer/consumer work | A bounded `BlockingQueue` | Capacity supplies backpressure; decide what happens when full |
| Concurrent key lookup/update | `ConcurrentHashMap` | No null keys/values; multi-key business operations are not automatically atomic |

`LinkedList` can unlink a node efficiently once positioned, but finding an index is linear, with allocation/locality overhead. "Lots of inserts means linked list" is not a sufficient performance argument — see section 4 for the full complexity comparison.

### Fixed-size, unmodifiable and immutable are different

`Arrays.asList(array)` returns a fixed-size list backed by that array: `set` works and affects the backing array, but structural `add/remove` do not. `Collections.unmodifiableList(source)` is a read-only **view**, so source changes remain visible.

`List.of` and `List.copyOf` are unmodifiable; neither makes mutable elements immutable. These factories reject null elements. `Set.of` rejects duplicates; `Map.of` rejects duplicate keys and null keys/values. Do not assume their iteration order is insertion order. Use an appropriate ordered implementation when order is part of the output contract.

### Java 21 sequenced collections: a useful API change

**The problem before Java 21:** every ordered collection had its own, inconsistent way to touch the two ends. `List` had `get(0)`/`get(list.size()-1)` and no symmetric "add at front" beyond index-0 inserts; `Deque` had `addFirst`/`addLast`/`getFirst`/`getLast`; `LinkedHashMap`/`LinkedHashSet` had no first/last access at all without manual iteration; and nothing offered a uniform "give me this collection in reverse order" view. If you wanted "the most-recently-inserted entry" from a `LinkedHashMap`, there was no direct method — you iterated to the end.

**What Java 21 adds:** three new interfaces that standardize "this collection has a defined encounter order, so first/last and reverse are meaningful operations":

| Interface | Extended by | New methods |
| --- | --- | --- |
| `SequencedCollection<E>` | `List`, `Deque`, `LinkedHashSet`, `SortedSet` (via `SequencedSet`) | `addFirst(e)`, `addLast(e)`, `getFirst()`, `getLast()`, `removeFirst()`, `removeLast()`, `reversed()` |
| `SequencedSet<E>` | `LinkedHashSet`, `SortedSet`/`TreeSet` | same, specialized to return a `SequencedSet` from `reversed()` |
| `SequencedMap<K,V>` | `LinkedHashMap`, `SortedMap`/`TreeMap` | `putFirst(k,v)`, `putLast(k,v)`, `firstEntry()`, `lastEntry()`, `pollFirstEntry()`, `pollLastEntry()`, `reversed()` |

So the practical win is: `ArrayList`, `LinkedList`, `ArrayDeque`, `LinkedHashSet`, `LinkedHashMap`, `TreeSet`, `TreeMap` **all** now expose the same first/last/reverse vocabulary, instead of each type inventing its own subset. Plain `HashMap`/`HashSet` do **not** implement these interfaces — there is no meaningful "first" element in an unordered hash table.

**The key new idea is `reversed()`.** It does not copy the collection; it returns a **live, reversed view** backed by the same underlying data. Reading through it walks the original from last to first, and writing through it (where mutation is supported) mutates the original. This is the part that confuses most people, so trace it step by step rather than reading it as one expression:

```java
import java.util.ArrayList;
import java.util.List;

class SequencedExample {
    static List<String> queueOrder() {
        var queue = new ArrayList<>(List.of("first", "second")); // queue = [first, second]
        var reversedView = queue.reversed();                     // reversedView = [second, first] (a view, not a copy)
        reversedView.addFirst("third");                          // insert "third" at the FRONT of the reversed view
        // the view's front corresponds to the ORIGINAL list's back,
        // so this is equivalent to queue.addLast("third")
        return List.copyOf(queue);                                // queue is now [first, second, third]
    }
}
```

Step by step: `queue` starts as `[first, second]`. `queue.reversed()` gives you a view that reads as `[second, first]` — same data, opposite traversal direction. Calling `addFirst("third")` on *that view* inserts at what the view calls position 0, which is the *original* list's last position. So the underlying `queue` ends up `[first, second, third]`, and `List.copyOf(queue)` snapshots that into an immutable list. If instead you had called `queue.addFirst("third")` directly (no `reversed()`), you'd get `[third, first, second]`.

Caveats: `reversed()` is a view, not a detached copy — further structural changes to `queue` are visible through `reversedView` and vice versa. Endpoint mutation is optional per implementation: a `TreeSet`/`TreeMap` rejects `addFirst`/`addLast`/`putFirst`/`putLast` with `UnsupportedOperationException` because an arbitrary explicit position would violate the sort order (only `reversed()` and the no-arg first/last reads/removals are supported there), and an unmodifiable list (`List.of(...)`) still rejects any mutation through either the original or the reversed view. `getFirst()`/`getLast()` throw `NoSuchElementException` on an empty collection.

### Iteration and concurrent updates

Ordinary fail-fast iterators may throw `ConcurrentModificationException` for unsupported structural changes, including changes by the **same thread**. This is best-effort bug detection, not a concurrency guarantee. Use an iterator's supported removal, `removeIf`, or build a new collection.

`ConcurrentHashMap` iterators are weakly consistent, not frozen snapshots. `CopyOnWriteArrayList` offers snapshot-style iteration and expensive writes; it fits rare-write/frequent-read workloads, not a high-volume write queue.

**Interview follow-up:** "Can I do `if (!map.containsKey(k)) map.put(k, v)` safely on a concurrent map?" Individual calls may be thread-safe, but that sequence is not atomic. Use `putIfAbsent`, `compute` or another operation matching the requirement. Keep compute callbacks short and free of recursive updates; do not assume arbitrary remote side effects become exactly-once.

## 3. Comparable vs Comparator, and `binarySearch`

| | `java.lang.Comparable` | `java.util.Comparator` |
| --- | --- | --- |
| Method | `int objOne.compareTo(objTwo)` | `int compare(objOne, objTwo)` |
| Return convention | Negative if `objOne < objTwo`, zero if equal, positive if `objOne > objTwo` | Same convention |
| Where it lives | You modify the class whose instances you want to sort | You build a separate class/lambda from the class being sorted |
| Sort sequences | Only one natural ordering | Many — one per `Comparator` you define |
| Typical implementers | `String`, the wrapper classes, `Date`, `Calendar` | Written to sort instances of third-party classes you can't modify |

`Collections.sort()` and `Arrays.sort()` are both static methods that mutate the collection/array they sort in place rather than returning a new sorted copy.

**Searching with `binarySearch()`:**

1. Both `Collections` and `Arrays` expose `binarySearch()` for locating an element.
2. A successful search returns the `int` index of the matched element.
3. An unsuccessful search returns a negative number encoding the insertion point: since `0` is already a valid index for a successful search, the first available insertion point is `-1`, so the actual insertion point is `(-(insertion point) - 1)`. For example, an insertion point at index 2 is returned as `-3`.
4. The collection/array **must** already be sorted before you search it — if it isn't, the result is unpredictable.
5. If it was sorted in natural order, search it in natural order (don't pass a `Comparator`).
6. If it was sorted using a `Comparator`, search it using that same `Comparator` as the second argument. Comparators cannot be used when searching arrays of primitives.

## 4. `ArrayList` vs `LinkedList`

| | `ArrayList` | `LinkedList` |
| --- | --- | --- |
| Interfaces implemented | `List` | Both `List` and `Deque` |
| Backing structure | Resizable array; elements stored contiguously | Doubly linked list of nodes, each holding data plus next/previous references |
| Element access | Direct index arithmetic (`get`/`set`) since it's backed by an array | Must walk the list from the nearer end |
| Default capacity | 10, doubling as needed | 0 — starts as an empty list with no preallocated capacity |
| Memory overhead | Low — just the element data in a contiguous block | Higher — each node also stores two neighbor references |
| Best at | `get()`/search-heavy workloads | Insertion/deletion-heavy workloads |

For `ArrayList`'s index access: elements laid out sequentially mean `get(20)` on an `int[]` starting at address 1000 just computes `1000 + 20 * 4 = 1080` — O(1), no traversal.

**Complexity, `LinkedList<E>`** (middle-of-list operations average `n/4` steps; endpoint operations are O(1) via `getFirst/getLast/addFirst/addLast/removeFirst/removeLast`):

| Operation | Complexity |
| --- | --- |
| `get(int index)` | O(n), O(1) at either end |
| `add(int index, E element)` | O(n), O(1) at either end |
| `remove(int index)` | O(n), O(1) at either end |
| `Iterator.remove()` | O(1) |
| `ListIterator.add(E element)` | O(1) |

**Complexity, `ArrayList<E>`** (middle-of-list operations average `n/2` steps):

| Operation | Complexity |
| --- | --- |
| `get(int index)` | O(1) |
| `add(E element)` | O(1) amortized, O(n) worst case (resize + copy) |
| `add(int index, E element)` | O(n) |
| `remove(int index)` | O(n) |
| `Iterator.remove()` | O(n) |
| `ListIterator.add(E element)` | O(n) |

**Rule of thumb:** frequent insertions/removals favor `LinkedList`'s O(1) at known positions; frequent `get()`/search favors `ArrayList`'s O(1) random access. In practice, measure — cache locality often makes `ArrayList` win even for insert-heavy workloads unless insertions are genuinely at a known `ListIterator` position.

## 5. Internal working of `HashMap`

`HashMap` works on the principle of hashing. Three terms matter: **hash function**, **hash value**, and **bucket**.

- The **hash function** is `hashCode()`, declared on `Object` and returning an `int`.
- The **hash value** is the `int` that function returns.
- A **bucket** stores key-value pairs; a `HashMap` bucket uses a simple linked-list-like structure internally (not `java.util.LinkedList`) to hold multiple entries that land in the same slot.

### How `get(Key k)` works internally

`get(Key k)` calls `hashCode()` on the key, feeds the result into `HashMap`'s own hash function to pick a bucket location in the backing array, and both the key and the value are stored together there as a nested `Map.Entry` object — not just the value. Saying "only the value is stored in the bucket" is a common wrong answer.

Step by step:

1. Check whether the key is `null`. `HashMap` permits exactly one null key; a null key always maps to hash `0`, i.e. bucket index 0.
2. If the key isn't null, call `key.hashCode()` to get the hash value, then re-hash it through `HashMap`'s own hash function. This extra re-hash step defends against poor-quality `hashCode()` implementations.
3. The final hash value picks the bucket. The `Entry` is conceptually `(hash, key, value, bucketIndex)`.

```java
public V put(K key, V value) {
    // locate bucket via hash(key.hashCode()); walk the bucket chain
    // return null if key was new, or the previous value if key already existed
}
```

### Collisions: what if two different keys hash to the same bucket?

`equals()` resolves it. The bucket is effectively a linked chain; `HashMap` walks it, comparing keys with `equals()` until it finds a match, then returns that entry's value. If the key being inserted is `equals()` to an existing one, the new value overwrites the old one. Any class used as a key — `String` and friends included — must override both `equals()` and `hashCode()` consistently, and should be immutable so its hash doesn't change after insertion.

### Performance parameters

Two parameters affect `HashMap` performance: **initial capacity** (number of buckets at creation) and **load factor** (how full the table may get before it's resized). When entry count exceeds `load factor × capacity`, the table is rehashed to roughly double the bucket count. The default load factor is `0.75`.

`get()`/`put()` are O(1) average case, assuming the hash function disperses keys well across buckets. A degenerate hash function that collides everything regresses toward O(n) per bucket (mitigated in modern JDKs by treeifying long chains into a red-black tree once a bucket grows past a threshold — see section 7).

### Resizing race condition (pre-Java 8 behavior, still a classic interview trap)

If two threads both observe that the map needs resizing and both start resizing concurrently, entries in a bucket's linked chain can get reversed during migration to the new bucket array — resizing historically appended the migrated element at the **head**, not the tail, to avoid a tail-traversal cost. Under a race, this can produce a cycle in the chain, and a subsequent `get()` can spin into an **infinite loop**. This is the canonical reason `HashMap` is documented as not thread-safe and `ConcurrentHashMap` exists (see section 11).

### Null key handling

`equals()`/`hashCode()` are not invoked for the null key at all. Historically this was handled by dedicated `putForNullKey`/`getForNullKey` paths for performance on the two hottest operations; conceptually, null always maps to index 0.

## 6. Internal working of `HashSet`

Uniqueness in `HashSet` is achieved through an internal `HashMap`. Creating a `HashSet` creates a backing `HashMap`; `add(E e)` stores `e` as the **key** and a shared dummy sentinel object (often named `PRESENT`) as the value:

```java
public boolean add(E e) {
    return map.put(e, PRESENT) == null;
}
```

`Map.put(key, value)` returns `null` if the key was new (added successfully) or the previous value if the key was a duplicate. `HashSet.add()` compares that return value against `null`: a `null` return means the element was new and really got added, so `add()` returns `true`.

## 7. `TreeSet`, `HashSet`, `LinkedHashSet` — and the Red-Black tree underneath

All three implement `Set`, so they share the no-duplicates contract, but differ in what else they guarantee:

- **`HashSet`** — backed by `HashMap`. General-purpose default: fast, duplicate-free, no ordering guarantee.
- **`LinkedHashSet`** — extends `HashSet`, with a linked list running through the backing map's entries to preserve **insertion order** without TreeSet's cost. Also useful for producing an order-preserving copy of an existing `Set`.
- **`TreeSet`** — backed by `TreeMap`, which is itself a red-black tree. Elements come out sorted (natural order or a supplied `Comparator`), at the cost of logarithmic operations instead of (expected) constant-time ones.

**Red-black trees**, briefly: a self-balancing binary search tree where each node carries an extra "color" bit (red or black). Insertions/deletions rebalance and recolor the tree to keep the documented balance invariants, guaranteeing O(log n) search, insert, and delete even in the worst case — unlike a naive BST, which degrades to O(n) on sorted input.

**Degenerate `HashMap`/`HashSet` buckets:** if many keys collide into the same hash bucket (adversarial or just unlucky input), a plain linked chain inside that bucket regresses toward O(n) lookups. Using a `TreeMap` sidesteps this by paying O(log n) unconditionally, ordering by hash code (and then by `compareTo`/`Comparable` if hash codes tie) rather than relying on bucket distribution. Modern JDK `HashMap` implementations also treeify an individual bucket into a mini red-black tree once its chain grows past an internal threshold, which caps the worst case without changing the public `HashMap` API.

## 8. `equals`/`hashCode` and why hash-based collections need them

Override `equals()`/`hashCode()` together, for two distinct reasons:

- **Logical equality** — especially for domain objects, where `==` (reference equality) isn't the comparison you actually want.
- **Correct behavior in hash-based collections/data structures** — `HashMap`, `HashSet`, and anything built on them rely on a consistent `hashCode()` to pick a bucket and a consistent `equals()` to resolve collisions within that bucket. An inconsistent pair (e.g. `equals()` overridden without `hashCode()`) breaks lookups: two "equal" objects can land in different buckets and never compare as the same key.

This is also why keys in a map (or elements in a set) should be **immutable**: mutating a key after insertion can change its hash code, stranding the entry in the wrong bucket so it can no longer be found by `get()`/`contains()`.

## 9. Iterators: fail-fast vs fail-safe, `Iterator` vs `ListIterator`, removing during iteration

### Fail-fast vs fail-safe

**Fail-fast** iterators detect, on a best-effort basis, that the collection's structure changed since iteration began (any thread adding/removing/updating an element while another thread — or even the same thread via the wrong API — is iterating) and throw `ConcurrentModificationException`. This is implemented via a modification counter checked during iteration; because the check itself isn't synchronized, a concurrent thread's change can occasionally go undetected. The Javadoc explicitly says this is not a guarantee applications may rely on. Iterators from `Vector`, `ArrayList`, `HashSet`, and most pre-concurrent-collections classes are fail-fast.

**Fail-safe** iterators never throw `ConcurrentModificationException` because they operate over a snapshot/clone rather than the live structure. `CopyOnWriteArrayList`'s iterator and `ConcurrentHashMap`'s `keySet()` iterator are fail-safe examples.

### Removing during iteration

`Collection.remove(Object)` and `List.remove(int index)` work fine when you're not iterating. While iterating, using either of those (instead of the iterator's own removal) throws `ConcurrentModificationException`. Use `Iterator.remove()` to remove the current element from the iterator's perspective during a traversal; it's the method actually designed for this.

### `Iterator` vs `ListIterator`

`Iterator` (which replaced the legacy `Enumeration`) only moves forward and supports removal with well-defined semantics. `ListIterator` adds: traversal in either direction, in-place modification of the list during iteration, and the ability to query the iterator's current position. A `ListIterator` has no "current element" as such — its cursor sits between the element `previous()` would return and the element `next()` would return; a list of length `n` has `n + 1` valid cursor positions, `0` through `n`.

### `poll()` vs `remove()` on `Queue`

Both remove and return the queue's head. On an empty queue, `remove()` throws, while `poll()` returns `null`. Which element counts as "head" depends on the queue's ordering policy — e.g. `PriorityQueue` keeps the lowest element per its `Comparator`/`Comparable` at the head.

## 10. `NavigableMap`, `Map` vs `Hashtable`, and why `Map` doesn't extend `Collection`

### `NavigableMap`

Added in Java 6 as an extension of `SortedMap` (which `TreeMap` implements), adding navigation methods like `lowerKey`, `floorKey`, `ceilingKey`, and `higherKey`, plus submap views: `headMap` (keys less than a given key), `tailMap` (keys greater than a given key), and `subMap` (keys strictly between a `fromKey` and `toKey`) — each with a boolean to control whether the boundary key itself is included. `TreeMap` and `ConcurrentSkipListMap` are the two concrete `NavigableMap` implementations. It's less reached-for than `HashMap`/`ConcurrentHashMap` in day-to-day code, but comes up whenever range queries matter.

### `Map` interface vs legacy `Hashtable`

- `Map` lets you iterate over keys, values, or key-value pairs; `Hashtable` predates that third option.
- `Map` provides a safe way to remove entries during iteration; `Hashtable` didn't.
- `Hashtable` has a `contains(Object)` method whose name misleadingly suggests key lookup when it actually checks **values** — the same confusion `containsValue` on `Map` was introduced to resolve, alongside the more expected `containsKey`.

### Why doesn't `Map` extend `Collection`?

Mainly because maps have an extra level of indirection that other collection types don't: a `Map` maps a key to a value, rather than directly holding "the" element.

- If `Map` were a `Collection`, what would its elements be? "Key-value pairs" is the only reasonable answer, but that's a weak abstraction — you couldn't ask what value a key maps to, or delete an entry by key alone, without that pair object.
- `Collection` could instead be made to extend `Map`, but then: what are the keys for a plain list or set? There's no satisfying answer, and forcing one produces an unnatural interface.
- Maps **can** be viewed as collections (of keys, values, or entries), and that's exactly what the three "collection view" operations — `keySet()`, `values()`, `entrySet()` — are for.
- The reverse view (a `List` as a `Map` from index to element) isn't offered, because removing a list element would silently shift the key associated with every subsequent element — a surprising side effect a real map view shouldn't have.

## 11. Thread-safety: `HashMap` vs `Hashtable` vs `SynchronizedMap` vs `ConcurrentHashMap`

`HashMap` and `Collections.synchronizedMap(new HashMap<>())` provide the same degree of synchronization. Wrapping `Hashtable` with `Collections.synchronizedMap()` would add a redundant extra layer of synchronization on top of an already-synchronized class.

The practical difference between `Hashtable` and `Collections.synchronizedMap(hashMap)` is mostly at the API level: `Hashtable` is legacy code retrofitted to implement `Map`, so wrapping a `Hashtable` with `synchronizedMap()` limits its exposed API down to the plain `Map` API — a behavior change if you depended on `Hashtable`-specific methods.

**`ConcurrentHashMap`** — use it when you need high concurrency:

- Thread-safe without synchronizing the whole map; no single object-level lock.
- Locking happens at a much finer granularity — historically per-segment/per-bucket rather than per-map.
- Reads are largely lock-free and fast; writes take a narrow lock.
- Iterating while another thread mutates the map does **not** throw `ConcurrentModificationException` (weakly consistent iteration, per section 2).

**`SynchronizedMap` (`Collections.synchronizedMap`)** — use it when you need strict data consistency and every thread must see an up-to-date view:

- Synchronization is at the whole-object level; every read/write acquires the lock.
- Locking the entire collection is a performance overhead, and effectively serializes all threads through it, one at a time.
- Its iterator **does** fail-fast on concurrent structural modification, i.e. it throws `ConcurrentModificationException`.

### Thread-safe collection classes

`Vector`, `Hashtable`, `Properties`, and `Stack` are synchronized by design and safe to use directly from multiple threads. For `List`/`Set`/`Map` classes that aren't inherently synchronized, `Collections.synchronizedXXX()` wraps them to add that synchronization.

## 12. Nulls across collection implementations

**Maps:**

| Implementation | Null keys | Null values |
| --- | --- | --- |
| `HashMap` | Accepts one null key | Any number |
| `LinkedHashMap` | Accepts one null key | Any number |
| `Hashtable` | Rejects null keys (always has) | Rejects null values |
| `TreeMap` | Rejects null keys — `Comparable`'s contract requires throwing `NullPointerException` for a null argument | Any number |

**Sets:**

| Implementation | Null elements |
| --- | --- |
| `HashSet` | Accepts one null element |
| `LinkedHashSet` | Accepts one null element |
| `TreeSet` | Rejects null elements (same `Comparable`/ordering constraint as `TreeMap`) |

**Lists:** `ArrayList`, `LinkedList`, and other `List` implementations generally accept nulls freely.

This connects back to the immutable-key point in section 8: an immutable key guarantees its hash code computation always yields the same result, which is exactly what a hash-based map/set depends on.

## 13. Specialized map/set types: `EnumSet`, `IdentityHashMap`, `WeakHashMap`

**`EnumSet`** — a specialized `Set` implementation for enum types; every element must come from a single enum type, specified explicitly or inferred from the first element added. Internally represented as a bit vector — `RegularEnumSet` uses a `long`, so it can represent up to 64 enum constants directly in that single word.

**`IdentityHashMap`** — implements `Map` using **reference equality** (`k1 == k2`) instead of `equals()`/`hashCode()` to compare keys (and values). Typical uses: topology-preserving object-graph transformations such as serialization or deep-copying, where a "node table" must track which object references have already been processed without accidentally merging distinct-but-`equals()` objects; also maintaining per-object proxies, e.g. in a debugging facility.

**`WeakHashMap`** — an entry is automatically removed once its key is no longer in ordinary use elsewhere; more precisely, holding a mapping for a key does not prevent that key from being garbage-collected. This makes it a reasonable building block for a memory-constrained cache, since the map itself cleans up unused entries rather than requiring explicit eviction logic.

## 14. Unmodifiable collections and the `Collections` utility class

`Collections.unmodifiableList/Set/Map(...)` wraps a collection in a read-only view; any attempted mutation throws `UnsupportedOperationException`. As noted in section 2, this is a **view** over the original — changes made directly to the underlying collection remain visible through it, unlike the fully immutable `List.of`/`Set.of`/`Map.of` factories.

Beyond the unmodifiable wrappers, `Collections` also provides: immutable empty collections, synchronized wrappers (`synchronizedList/Set/Map`), `binarySearch`, `min`, `max`, `reverse`, `shuffle`, and `sort`.

## 15. Related data structures beyond `java.util`

These two don't live in `java.util` and aren't core "pick the right `Map` implementation" material, but they show up in system-design-adjacent interview conversations about spatial indexing and modern search/retrieval, so they're captured here rather than dropped.

### Quad Tree

A quadtree efficiently stores points in two-dimensional space. Each node has at most four children, built by:

1. Dividing the current 2D space into four boxes.
2. For each box containing one or more points, creating a child node for that box's sub-space.
3. Leaving boxes with no points childless.
4. Recursing into each created child.

Applications include image compression (each node holds the average color of its children; deeper traversal reveals more detail) and spatial nearest-point search (finding the closest point to given coordinates, or nearby points for something like a ride-sharing service, without scanning every point).

### Vector databases

A vector database stores, indexes, and queries high-dimensional vectors — numerical representations of data points, often produced by machine-learning embeddings, where each dimension captures some feature of the original text/image/audio. The typical workflow:

1. **Embed** — an ML model (NLP, computer vision, etc.) converts raw data into vectors.
2. **Store** — the resulting vector embeddings are persisted in the vector database.
3. **Search** — given a query vector, the database finds the closest/most-similar stored vectors, typically via an Approximate Nearest Neighbor (ANN) algorithm rather than an exact linear scan.

This underpins similarity search, recommendation systems, semantic search, and retrieval for generative-AI pipelines.
