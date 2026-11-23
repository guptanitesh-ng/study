# DSA Practice Log

Reviewed: November 20, 2026. Purpose: a tracking template for deliberate LeetCode 150 practice, not a notes file — at 20+ YOE the gap isn't knowing what a hash map or BFS is, it's pattern-recall speed under time pressure. This file exists to prioritize by rust, not grind front-to-back, and to force spaced re-solves instead of a single pass.

**Note on list choice:** this tracker is built around LeetCode's own "Top Interview 150" list. NeetCode 150 (a separate, community-curated list) covers largely the same 18 patterns with less redundancy and free video walkthroughs per problem — a reasonable swap if a particular LC 150 problem's editorial/discussion isn't clicking, but not a reason to switch lists wholesale given the plan below is already built around this one.

## Why prioritize instead of grinding sequentially

Years of production Java/Spring work build deep, fast intuition for some patterns and almost none for others. Triage the 150 by that reality before you start:

| Likely strong already (light review only) | Likely rusty (practice first) |
|---|---|
| Array/String, Hashmap, Stack, Two Pointers, Sliding Window, Linked List | Graphs (general + BFS), Backtracking, Tries, 1D & Multidimensional DP, Bit Manipulation, Binary Search edge cases, Heap |

Spend disproportionate reps on the right-hand column. The left-hand column just needs a handful of timed reps to confirm the speed is still there.

## LeetCode 150 — pattern breakdown (150 total: 40 Easy / 92 Medium / 18 Hard)

| # | Pattern | Approx. problems | Priority |
|---|---|---|---|
| 1 | Array / String | 24 | Light review |
| 2 | Two Pointers | 5 | Light review |
| 3 | Sliding Window | 4 | Light review |
| 4 | Matrix | 3 | Light review |
| 5 | Hashmap | 6 | Light review |
| 6 | Intervals | 4 | Practice |
| 7 | Stack | 5 | Light review |
| 8 | Linked List | 11 | Light review |
| 9 | Binary Tree General | 14 | Practice |
| 10 | Binary Search Tree | 4 | Practice |
| 11 | Graph General | 8 | Practice first |
| 12 | Graph BFS | 5 | Practice first |
| 13 | Trie | 3 | Practice first |
| 14 | Backtracking | 6 | Practice first |
| 15 | Divide and Conquer | 4 | Practice |
| 16 | Kadane's Algorithm | 3 | Practice |
| 17 | Binary Search | 7 | Practice |
| 18 | Heap | 5 | Practice |
| 19 | Bit Manipulation | 6 | Practice first |
| 20 | Math | 6 | Practice |
| 21 | 1D DP | 5 | Practice first |
| 22 | Multidimensional DP | 9 | Practice first |

(Counts are approximate groupings from the official list; use the list itself as source of truth for exact problems.)

## How to use this file

1. Pick the next problem from a "Practice first" pattern (rotate; don't binge one pattern for days). Knowing the category (e.g. "today's pick is from Graphs") is fine and intentional — that's what drives the rotation.
2. Solve it **timed, without reading the editorial/discussion/approach hints first** — 20-25 min for Medium, 30-35 min for Hard. The point isn't hiding which pattern bucket it came from; it's not pre-loading the specific technique (e.g. "this is Dijkstra") before you've tried to recognize it yourself from the problem statement. If stuck past the timer, look up the approach, retry, then read the full solution only after your own attempt.
3. Log one row below. Keep the "gap" terse — it's what you review, not a write-up.
4. Every 2-3 days, re-solve (cold, no notes) 2-3 problems from the "Gaps found next" queue before taking new ones. Recall under a gap is the actual signal; solving it once proves nothing.

### Spaced repetition cycle (why re-solving beats a single pass)

Solving a problem once only proves you can reproduce an answer with it fresh in mind — not that you'd recognize the pattern cold, weeks later, under interview pressure. That cold recognition is what decays fastest and what actually gets tested. The cycle:

1. **First solve** — attempt it, log the gap honestly (e.g., "didn't see it was sliding window, started with brute force").
2. **Don't move on immediately.** In 2-3 days, re-solve that same problem (or a close sibling from the same pattern) completely cold — no notes, timed.
3. **Judge the re-solve, not the first solve.** Immediate recognition + clean code = the pattern has stuck. Back to brute-force instinct = it hasn't; log it again and set another review date.
4. **Repeat until a pattern survives a cold re-solve**, then graduate it — stop actively reviewing and trust it for the interview.

A single front-to-back pass through all 150 feels like progress, but by problem 100 problem 10 has already faded untested. Spaced re-solving is slower in raw problem count but builds durable recall instead of a false sense of completion.

## Log

| Date | Problem | Pattern | Difficulty | Solved cleanly? | Gap found (review next) | Next review date |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |

## Recurring gaps to watch for (seed this from real reps, don't pre-fill)

- Recognizing the pattern late (e.g., writing brute force before spotting it's a sliding window / binary search on answer).
- Off-by-one errors in binary search bounds or interval merging.
- Defaulting to recursion depth-first when BFS/iterative is the right shape for the actual question (shortest path, level-order).
- DP: jumping to code before writing the recurrence/state transition in words first.
- Rushing past edge cases (empty input, single element, duplicates) that production habits normally catch but timed-practice anxiety skips.
