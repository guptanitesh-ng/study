# Legacy Algorithms Reference

Reviewed: November 20, 2026. Source: `Algorithms.pdf` (personal collection from interviews ~10 years ago). Purpose: a corrected, LeetCode-150-mapped reference for periodic review — not a practice tracker (see `DSA-Practice-Log.md` for that). Kept alongside DSA because most entries map directly onto patterns already in the 150 set; a couple are system-design-flavored and are noted as such rather than true DSA.

Several items below had bugs or gaps in the original PDF — these are corrected here and flagged with ⚠️ **Corrected**.

## Difficulty map (vs. LeetCode 150)

| # | Topic | Difficulty | LC equivalent | Notes |
|---|---|---|---|---|
| 1 | Round-robin scheduling | Easy | — | Queue simulation; not in LC 150 |
| 2 | Reverse words in a string | Easy | LC 151 | |
| 3 | Find the duplicate in 1..100 array | Easy | LC 268 / 287 | |
| 4 | Count repeated words in a file | Easy | — | Hashmap counting; I/O-flavored |
| 5 | Polynomial addition | Easy | — | Not in LC 150 |
| 6 | Insertion sort on a nearly-sorted array | Easy | — | Sorting fundamentals |
| 7 | Remove duplicates preserving order (LinkedHashSet) | Easy | LC 26-adjacent | |
| 8 | Linked list cycle detection (Floyd's) | Easy–Medium | LC 141 / 142 | Already covered by LC 150 Linked List pattern |
| 9 | First occurrence in sorted array (binary search variant) | Medium | LC 34 | |
| 10 | Two duplicates via sum/product equations | Medium (niche) | — | ⚠️ overflow caveat for large n |
| 11 | Find duplicates using array-as-hashmap | Medium | LC 442 | |
| 12 | Array shuffle | Medium | LC 384 | ⚠️ **Corrected** — see below |
| 13 | Largest number from an array | Medium | LC 179 | ⚠️ **Corrected** — see below |
| 14 | Polynomial multiplication | Medium | — | Not in LC 150 |
| 15 | Self-expiring map | Medium | — | Design-a-class question, not in LC 150 |
| 16 | Merge sort / Quick sort / Heap sort implementations | Medium | — | Sorting fundamentals; heap sort ⚠️ **Corrected** below |
| 17 | Divide & Conquer vs. DP (conceptual) | Medium | — | Conceptual, pairs with LC 150 DP section |
| 18 | Multi-stream k-way merge (log merge) | Medium–Hard | LC 23 (Merge k Sorted Lists) | Borderline system-design |
| 19 | External sort for huge datasets | Hard / system design | — | Not a coding-interview DSA problem; better suited to System Design notes |

**Bottom line:** 15 of 19 topics map directly onto an existing LC 150 pattern you're already drilling — so active LC 150 practice supersedes most of this. Keep this file as periodic *review* material (not primary practice), since production rust is more likely here than in day-to-day coding patterns. #18 and #19 are flagged for cross-reference with System Design rather than treated as DSA gaps.

## Corrections to the original PDF

### Largest number arrangement (topic 13)
Original PDF offered two methods. Method 1 (custom comparator: concatenate `a+b` vs `b+a`, pick the larger) is correct and is the standard LC 179 solution. **Method 2 (multiply by `10^digits` to compare) is incorrect** — it does not reliably order numbers like `9` and `34` correctly in all cases. Use Method 1 only.

### Array shuffle (topic 12)
The original description was vague and referenced a nonexistent `PermutationGenerator` class. The correct, standard algorithm is **Fisher–Yates shuffle**:

```java
void shuffle(int[] arr) {
    Random rnd = new Random();
    for (int i = arr.length - 1; i > 0; i--) {
        int j = rnd.nextInt(i + 1);
        int tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
}
```
This is O(n), produces a uniformly random permutation, and is exactly what LC 384 "Shuffle an Array" expects.

### Heap sort pseudocode (topic 16)
The PDF's `heapify` was incomplete — it swapped the root with the last element but did not recursively sift the new root down. Correct version:

```java
void heapify(int[] arr, int n, int i) {
    int largest = i, l = 2 * i + 1, r = 2 * i + 2;
    if (l < n && arr[l] > arr[largest]) largest = l;
    if (r < n && arr[r] > arr[largest]) largest = r;
    if (largest != i) {
        int tmp = arr[i]; arr[i] = arr[largest]; arr[largest] = tmp;
        heapify(arr, n, largest); // recurse into the affected subtree
    }
}
```

### Two-duplicates via sum/product (topic 10)
Works for small arrays but **overflows for large n** since the product grows factorially-ish. For n beyond ~15–20 elements with large values, prefer the array-as-hashmap approach (topic 11) or a `HashSet`, both of which don't have this caveat.

### Private-project class references
A couple of PDF entries (`LargestAnagramGroup`, `SelfExpiringHashMap`) referenced classes from old private projects, not portable as standalone answers. The self-expiring map concept is still a reasonable "design a class" interview question — implement with a `ConcurrentHashMap` + a background sweeper thread or lazy expiry check on `get`/`put`.
