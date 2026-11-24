## 1. Threads, tasks and the executing thread

### Foundation: the task, Thread object and executing thread are distinct

A `Runnable` describes work. A `Thread` object represents a thread's lifecycle. `new Thread(task)` creates that object; `start()` arranges separate execution of the task. Until start it is NEW and not alive. After its run method ends normally or exceptionally, it terminates and cannot be restarted.

```java
class StartingThreads {
    static void show() throws InterruptedException {
        Runnable task = () ->
                System.out.println(Thread.currentThread().getName());

        Thread worker = new Thread(task, "worker");
        worker.run(); // Ordinary call: runs on this calling thread.
        worker.start(); // Separate execution: prints worker.
        worker.join(); // This calling thread waits for worker's termination.
        System.out.println(worker.isAlive()); // false
    }
}
```

The first printed name is the caller's, commonly `main`; the second is `worker`. Join makes the final observation occur after termination. A second `start()` on the same object throws even after join: create a new Thread for another execution. Do not call both run/start as a normal launch pattern; they are contrasted here to expose the difference.

Extending Thread and overriding public `run()` is also legal. Implementing Runnable normally separates work from the execution mechanism and leaves the task class free to extend another class. Several Thread objects can share one Runnable, so its fields can be shared state. Each execution has its own call stack, but that does not give it a private copy of referenced objects.

Platform threads are typically scheduled by the OS; the old claim that the JVM schedules them independently of the OS is too broad. Virtual threads introduce an additional runtime scheduling layer, covered in section 16.

### Green threads versus native (platform) threads

Early JVMs on some platforms used *green threads*: all Java threads multiplexed onto a single OS thread, scheduled entirely by the JVM. Modern HotSpot uses *native threads*: each platform `Thread` maps to one OS thread, scheduled by the OS. Virtual threads (section 16) reintroduce a JVM-managed scheduling layer, but on top of native carrier threads rather than instead of them — this is a different design from historical green threads, not a reversion to them.

### Daemon threads

A daemon thread does not keep the JVM alive by itself; the JVM exits once only daemon threads remain. Set `thread.setDaemon(true)` **before** calling `start()` — calling it after start throws `IllegalThreadStateException`. Background housekeeping (cache eviction, metrics flushing) is a typical daemon use; do not rely on a daemon thread's `finally` block running to completion, since the JVM can exit mid-task.

```java
class DaemonWorker {
    static void startHousekeeping() {
        Thread cleaner = new Thread(DaemonWorker::sweep, "cache-cleaner");
        cleaner.setDaemon(true);
        cleaner.start();
    }

    private static void sweep() {
        while (true) {
            // evict expired entries; no guarantee this loop ever "finishes" cleanly
        }
    }
}
```

Virtual threads are always daemon threads (see section 16): a program that only launches virtual threads and does not otherwise block will exit before they complete unless it explicitly waits.

## 2. The Java Memory Model: atomicity, visibility and ordering

The Java Memory Model (JMM) was revised in Java 5 (JSR-133). The resulting happens-before rules still underpin Java 21; virtual threads do not replace them.

**Why Java 5 was a breaking fix, not a tweak:** the pre-JSR-133 JMM (Java 1.0–1.4) was badly underspecified and let compilers/JITs/CPUs reorder code in ways that broke intuitive idioms:

- **`final` fields gave no real guarantee.** A reference to a partially-constructed object could become visible to another thread before its `final` fields were set, so "finish construction, then publish" was not actually safe without extra synchronization. JSR-133 fixed this: a thread that obtains a reference *after* construction completes (and the reference did not escape during construction) is now guaranteed to see correctly initialized `final` fields — no lock or volatile required.
- **`volatile` only guaranteed visibility of that one variable**, not a happens-before ordering with surrounding non-volatile reads/writes. Compilers and CPUs could still reorder code around a volatile access, which is exactly what broke the classic (pre-fix) double-checked-locking idiom. JSR-133 upgraded `volatile` to a full memory barrier with happens-before semantics, which is what makes `private volatile static Helper instance;` in section 3 actually work.
- **There was no formal happens-before relation** to reason about cross-thread visibility — vendors interpreted the spec inconsistently. JSR-133 introduced happens-before as the one authoritative model (synchronized blocks, volatile reads/writes, thread start/join, etc.), and every concurrency guarantee discussed in this guide is ultimately justified in terms of it.

**What happens-before actually gives you.** It is a partial order over actions (reads/writes/locks/thread operations), not a claim about wall-clock timing. If action A happens-before action B, the JMM guarantees A's effects (every write A made) are visible to B — the JIT and CPU may still reorder things, but never in a way that would violate an established happens-before edge. The concrete edges that create this order:

- **Program order**: within a single thread, each action happens-before every later action in that thread's own code (the thread always sees its own writes in order).
- **Monitor lock rule**: an unlock of a monitor happens-before every later lock of that *same* monitor by any thread — this is what makes `synchronized` blocks safe for both mutual exclusion and visibility.
- **Volatile variable rule**: a write to a `volatile` field happens-before every subsequent read of that *same* field by any thread.
- **Thread start/join rules**: `Thread.start()` happens-before anything the new thread does; everything a thread does happens-before another thread's successful `Thread.join()` on it.
- **Transitivity**: if A happens-before B, and B happens-before C, then A happens-before C — even if A and C are in different threads that never directly synchronize with each other.

Transitivity is the part that is easy to use without noticing it:

```java
class Pipeline {
    private int payload;              // plain field, no synchronization
    private volatile boolean ready;   // publishes the payload

    // Thread A (producer)
    void produce() {
        payload = 42;   // (1) plain write
        ready = true;   // (2) volatile write — happens-after (1) by program order
    }

    // Thread B (consumer)
    void consume() {
        if (ready) {               // (3) volatile read
            System.out.println(payload); // (4) guaranteed to see 42, never 0
        }
    }
}
```

`(1)` happens-before `(2)` by program order. `(2)` happens-before `(3)` by the volatile rule, *if* `(3)` actually observes the value written by `(2)`. By transitivity, `(1)` happens-before `(4)`, so the plain `payload` write is guaranteed visible even though `payload` itself is never synchronized — the `volatile` flag is doing double duty as a visibility fence for everything written before it. This is the exact mechanism behind safe publication via a volatile reference, an `ExecutorService` submission, or a `BlockingQueue` handoff: one synchronized/volatile/concurrent-collection operation on the "send" side, paired with the matching operation on the "receive" side, drags along every plain write that preceded it in program order.

Without a happens-before edge between two actions, the JMM makes **no guarantee at all** — not "probably fine," not "fine on x86." A compiler is free to cache a field in a register, a CPU is free to reorder the store buffer, and two threads can disagree forever about whether a write ever happened. That is the failure mode JSR-133 formalized a fix for, and it is why every mechanism in this guide (`volatile`, `synchronized`, locks, atomics, concurrent collections) is really just a different way of establishing a specific happens-before edge.

### `final` fields and constructor safety

A correctly-constructed object's `final` fields are guaranteed visible to any thread that obtains a reference to it **after construction completes**, without extra synchronization — provided the reference did not escape during construction (no `this` passed to another thread, no listener registration, no starting a thread from inside the constructor). This is one of the few JMM guarantees that requires no explicit lock or volatile:

```java
final class ImmutablePoint {
    private final int x;
    private final int y;

    ImmutablePoint(int x, int y) {
        this.x = x;
        this.y = y;
        // Do not do: SharedRegistry.register(this); — that would leak `this`
        // before the final fields are guaranteed visible to other threads.
    }

    int x() { return x; }
    int y() { return y; }
}
```

If the constructor leaks `this` (registers a listener, starts a thread, assigns `this` to a static field) before returning, another thread can observe the object before its final fields are set — the guarantee only covers references obtained after the constructor has returned normally.

## 3. Double-checked locking and the initialization-on-demand holder

### The classic broken double-checked locking idiom

A tempting but historically broken pattern for lazy singleton initialization:

```java
class BrokenSingleton {
    private static Helper instance; // missing volatile

    static Helper getInstance() {
        if (instance == null) {            // first check, unsynchronized
            synchronized (BrokenSingleton.class) {
                if (instance == null) {    // second check, synchronized
                    instance = new Helper(); // THE PROBLEM
                }
            }
        }
        return instance;
    }
}
```

Without `volatile`, another thread can observe `instance` as non-null **before** the constructor's writes to `Helper`'s fields are visible to it — the JMM permits reordering that publishes the reference before the object it points to is fully initialized from that reader's perspective. The reader's first unsynchronized check can then return a partially-constructed `Helper`.

### Fix 1: `volatile`

```java
class VolatileDoubleChecked {
    private static volatile Helper instance;

    static Helper getInstance() {
        Helper result = instance;
        if (result == null) {
            synchronized (VolatileDoubleChecked.class) {
                result = instance;
                if (result == null) {
                    instance = result = new Helper();
                }
            }
        }
        return result;
    }
}
```

Making the field `volatile` (Java 5+, under the revised JMM) restores the needed happens-before edge: a volatile write of a fully-constructed reference happens-before a subsequent volatile read of it.

**Why the local `result` variable is there:** it is a performance optimization, not a correctness requirement. Reading `instance` directly at every point (both checks and the final `return`) would be equally correct — `volatile` alone already provides the visibility guarantee. But each read of a volatile field blocks certain JIT optimizations (e.g. caching it in a register), so this idiom reads `instance` into a plain local once per path and reuses that local for the subsequent check/return, cutting the fast path down to a single volatile read instead of two. This is Goetz's/Bloch's standard form of the pattern; a version without `result` is not wrong, just slightly less efficient.

### Fix 2: initialization-on-demand holder idiom (preferred)

```java
class HolderSingleton {
    private HolderSingleton() { }

    private static class Holder {
        static final Helper INSTANCE = new Helper();
    }

    static Helper getInstance() {
        return Holder.INSTANCE;
    }
}
```

The JVM guarantees a class is initialized at most once, lazily on first active use, with the necessary synchronization built into classloading itself — `Holder` is not loaded (and `Helper` not constructed) until `getInstance()` first runs, and every thread is guaranteed to see the fully-initialized `INSTANCE` with no explicit lock or volatile field in application code. This is generally preferred over the volatile double-checked form: it is simpler, relies on a guarantee the platform already provides, and cannot be subtly broken by forgetting `volatile`.

## 4. Immutability and safe publication

An immutable object cannot be observed in an inconsistent state by another thread, because no thread ever mutates it after construction — this sidesteps most visibility and atomicity concerns entirely rather than solving them with locks.

### Requirements for a genuinely immutable object

1. State cannot be modified after construction — no setters, no mutating methods.
2. All fields are `final`.
3. The object is properly constructed — `this` does not escape during construction (see section 2's final-field discussion).
4. Any mutable fields it holds are either not exposed (encapsulated and never returned directly) or are themselves immutable/defensively copied on the way in and out.

```java
import java.util.Collections;
import java.util.List;
import java.util.ArrayList;

final class ImmutableOrder {
    private final String id;
    private final List<String> items;

    ImmutableOrder(String id, List<String> items) {
        this.id = id;
        this.items = Collections.unmodifiableList(new ArrayList<>(items)); // defensive copy
    }

    String id() { return id; }

    List<String> items() { return items; } // safe: caller cannot mutate the backing list
}
```

Returning `items` directly without the defensive copy/unmodifiable wrapper would let a caller mutate the "immutable" order's internal list — the class would be effectively immutable from its own code's perspective but not truly immutable from the outside.

### Effectively immutable and thread confinement

An object can be technically mutable (not `final` fields throughout) but never actually mutated after being shared — "effectively immutable." This is weaker and relies on a discipline the compiler cannot enforce; prefer true immutability when practical.

**Thread confinement**: state that is never shared across threads needs no synchronization at all. Three common policies:

- **Ad-hoc confinement**: the program's logic happens to keep an object on one thread, with no language enforcement — fragile under refactoring.
- **Stack confinement**: a local variable is inherently confined to the executing thread's stack, as long as it is never published (passed to another thread, stored in a shared field).
- **ThreadLocal-based confinement**: each thread gets its own independent instance explicitly (see section 12) — the common production-grade pattern (e.g., non-thread-safe `SimpleDateFormat`/connection-per-thread patterns).

### Safe publication

"Safe publication" means another thread is guaranteed to see the object in a fully-constructed, consistent state when it first observes a reference to it. Unsafe publication (assigning to a plain, non-volatile shared field with no other synchronization) can let another thread observe a reference before the object's fields are visible. Safe publication mechanisms:

- Initializing an object reference from a static initializer.
- Storing the reference into a `volatile` field or an `AtomicReference`.
- Storing the reference into a `final` field of a properly constructed object (section 2).
- Storing the reference into a field properly guarded by a lock.
- Placing the reference into an already-safe concurrent collection (e.g., `ConcurrentHashMap`, section 11).

## 5. Volatile and atomic variables

### Volatile: more than a "main-memory copy", less than a lock

A volatile write happens-before subsequent reads of that field under the memory model; this provides visibility/ordering guarantees. It is not best understood as forcing every access to fetch from physical RAM. **Static volatile fields are legal too** — volatile is not instance-only.

**Why "more than a main-memory copy" (the common misconception):** people often picture volatile as "bypass the CPU cache, always read/write RAM directly." That mental model is incomplete — modern CPUs stay cache-coherent regardless of `volatile`, so a plain field's updated value does eventually become visible to other cores too. What `volatile` actually adds is two things the JMM would otherwise not guarantee at all: (1) the happens-before edge itself (a reader is *guaranteed* to see the write and everything that happened-before it, not just *likely* to, eventually), and (2) a ban on the compiler/JIT reordering surrounding code across that read/write (no caching the field in a register, no hoisting a loop condition check out of a loop, no reordering independent writes around it). So `volatile` is "more than a memory copy" — it is a reordering fence plus a cross-thread visibility contract, not a cache-bypass switch.

**Why "less than a lock":** `volatile int count; count++;` is not an atomic increment — `count++` is read-modify-write (read `count`, add 1, write back), and `volatile` only makes each of those individual reads and writes visible; it does not make the three-step sequence indivisible. Two threads can both read the same value, both increment it, and both write back the same result, silently losing an update:

```java
class LostUpdateDemo {
    private volatile int count;

    void increment() {
        count++; // read, add, write — not atomic even though count is volatile
    }

    int get() {
        return count;
    }
}
```

Run `increment()` concurrently from many threads and `get()` will typically return less than the true number of calls — `volatile` guarantees every thread sees the latest write, but says nothing about the gap between reading a value and writing back a new one. A volatile reference makes reference updates visible, not all subsequent unsynchronized mutations of the object thread-safe. Non-volatile `long`/`double` reads/writes may be non-atomic under the specification; do not rely on a particular 64-bit implementation to provide a stronger portable contract.

**When volatile alone is enough, and when it isn't:** volatile is sufficient for a single independently-meaningful field — a status flag (`stopping`), a published immutable reference (safe publication), a "latest value wins" setting. It is not enough when an operation must read-then-write as one step (counters, check-then-act, maintaining an invariant across two or more fields) — those need `synchronized`, a lock, or an atomic/CAS-based class instead.

```java
import java.util.concurrent.atomic.AtomicInteger;

class SharedState {
    private volatile boolean stopping;
    private final AtomicInteger completed = new AtomicInteger();

    void requestStop() {
        stopping = true;
    }

    boolean isStopping() {
        return stopping;
    }

    void recordCompletion() {
        completed.incrementAndGet();
    }

    int completedCount() {
        return completed.get();
    }
}
```

This makes each operation meaningful independently; it does not promise that stopping and the count form one atomic snapshot.

### Compare-and-swap (CAS) underlies the atomic classes

`AtomicInteger`, `AtomicLong`, `AtomicReference` and friends are backed by CPU compare-and-swap instructions, not locks: `compareAndSet(expected, update)` atomically replaces a value only if it still equals `expected`, returning whether it succeeded. This is the building block for lock-free algorithms — retry in a loop until the CAS succeeds.

**The atomicity itself comes from the CPU, not the JVM.** CAS is a single hardware instruction (`CMPXCHG` on x86, `LDREX`/`STREX` or `CAS` on ARM) — the processor guarantees no other core can observe or interleave a partial compare-and-store; that is a hardware cache-coherency guarantee, not something Java-level code enforces. The JVM's role is to expose that instruction safely: `compareAndSet` is a JIT intrinsic (historically via `sun.misc.Unsafe`, now `VarHandle`) that compiles straight down to the native CAS instruction, and the JVM/JMM additionally attaches the correct happens-before/memory-barrier semantics around it so the operation is also properly ordered with respect to other threads. So: the "no half-finished swap is visible" guarantee is hardware; the cross-thread visibility/ordering guarantee layered on top of it is JVM/JMM.

```java
import java.util.concurrent.atomic.AtomicInteger;

class CasCounter {
    private final AtomicInteger value = new AtomicInteger();

    int incrementIfBelow(int limit) {
        while (true) {
            int current = value.get();
            if (current >= limit) {
                return current;
            }
            if (value.compareAndSet(current, current + 1)) {
                return current + 1;
            }
            // Someone else updated first; reread and retry.
        }
    }
}
```

`LongAdder` (Java 8) can improve highly contended statistical counters by striping the count across cells and summing on read, but its `sum()` is not an atomic snapshot suitable for every balance/limit decision — prefer `AtomicLong` when a single consistent value is needed, `LongAdder` when only the eventual total matters and contention is high.

## 6. Synchronized, monitors and the lock protocol

An instance synchronized method locks `this`; a static synchronized method locks that class's `Class` object. They are different locks. A synchronized block locks its specified object. Two synchronized methods using the same lock exclude each other; unsynchronized code does not become protected merely because some methods synchronize.

Monitor locks are reentrant: a thread can reacquire a lock it already holds. Unlocking a monitor happens-before a subsequent lock of that same monitor. Every read/write participating in the protected invariant must obey the same protocol.

**Scenario:** all writes synchronize, but an unsynchronized getter still returns stale state. The missing read-side synchronization/visibility is the defect. Adding `synchronized` to an unrelated method or locking a different object does not repair it.

**Lock-object recall:** `synchronized (lock)` coordinates only with other code acquiring that **same object**. Two different account instances do not exclude each other through their separate synchronized instance methods. Static synchronized methods share the Class object's monitor instead. A lock is released when the protected block exits, including by exception; calling sleep inside it does not release it.

### Guidelines for choosing what to synchronize

- Keep synchronized blocks as short as possible — hold the lock only around the actual shared-state access, not around I/O, logging or calls into unrelated code.
- Never call into untrusted/overridable code (alien methods) while holding a lock; a misbehaving override can reenter your code and deadlock or corrupt state.
- Document a class's locking policy (which lock guards which fields) so maintainers extend it consistently; "synchronize whichever method you're editing" degrades into partial protection.
- Prefer confining mutable state to one thread (thread confinement, section 4) over adding more locks when the design allows it.

## 7. Thread lifecycle, wait/notify and interruption

### Thread lifecycle: API states versus scheduling diagrams

Calling `run()` directly is an ordinary call on the current thread. `start()` schedules a new thread that will execute `run()`. A thread can be started only once; repeated start throws `IllegalThreadStateException`. Multiple threads can run the same `Runnable`, which means its mutable state may be shared.

Java's `Thread.State` values are `NEW`, `RUNNABLE`, `BLOCKED`, `WAITING`, `TIMED_WAITING`, `TERMINATED`. There is no separate API enum state called `RUNNING`: RUNNABLE covers runnable/executing states. `BLOCKED` specifically concerns waiting to acquire a monitor; not every blocked I/O or lock operation appears as that state.

Thread priorities, start order, `sleep` and `yield` do not establish fairness or reliable execution order. A claim that sleep guarantees turn-taking is **never a valid guarantee** — priorities are scheduling hints that the OS/JVM may interpret loosely or ignore.

| Operation | Effect | Lock/interruption detail |
| --- | --- | --- |
| `Thread.sleep(...)` | Pause the current thread, subject to scheduling/timer behavior | Does not release held monitors; can throw `InterruptedException` |
| `Thread.yield()` | Scheduler hint | May be ignored; not a coordination primitive |
| `thread.join()` | Wait for that thread to terminate | A successful termination observation has defined visibility effects |
| `object.wait()` | Wait on that object's monitor wait set | Must own that monitor; releases it while waiting and reacquires before return |
| `notify/notifyAll` | Make monitor waiters eligible to proceed | Must own the same monitor; does not immediately transfer the lock |

### Wait in a loop: wake-up is not the condition itself

```java
class CompletionSignal {
    private boolean done;

    synchronized void await() throws InterruptedException {
        while (!done) {
            wait();
        }
    }

    synchronized void complete() {
        done = true;
        notifyAll();
    }
}
```

The loop handles spurious wake-ups and competition with other awakened threads. A notification is not stored for future waiters, but the protected `done` state means a later caller can proceed without waiting. `notify` selects an arbitrary waiter; use it only when the condition protocol makes that safe. Prefer `CountDownLatch`, futures, blocking queues or other higher-level tools for common coordination needs.

#### Foundation: walk the wait/notify handoff one step at a time

For `CompletionSignal`, both synchronized methods use the signal instance as their monitor:

1. The waiting caller acquires that monitor and checks `done`.
2. If false, `wait()` puts the caller into the object's wait set and releases **that monitor**, not every lock the thread might hold.
3. The completing caller acquires the monitor, sets `done = true`, and calls `notifyAll()`.
4. Notification makes waiters eligible to proceed; the completing caller still holds the monitor until it exits the synchronized method.
5. A waiter must reacquire the monitor before wait returns, then recheck the condition. Notification alone is not permission to skip that check.

Calling wait/notify without owning the target object's monitor throws `IllegalMonitorStateException`. Holding `lockA` and calling `lockB.wait()` does not satisfy the rule. `sleep()` pauses the current thread without releasing its monitors; `join()` waits for a particular thread's termination; `wait()` is about a shared condition guarded by a monitor.

Sleep/yield/priorities are scheduling controls or hints, not a substitute for this handoff. Timed sleep depends on timer/scheduler accuracy and interruption; it provides no precise wake-up deadline or turn-taking guarantee.

### Interrupt is cooperative cancellation

`interrupt()` does not forcibly kill arbitrary code. Blocking interruptible methods may throw `InterruptedException` and clear the interrupt flag; other code must check the flag and honor a cancellation policy. `Thread.interrupted()` checks and clears the **current** thread's flag; `isInterrupted()` checks a thread without clearing it.

If the method can propagate `InterruptedException`, usually propagate it. If an API boundary prevents propagation, restore the flag with `Thread.currentThread().interrupt()` and stop/translate appropriately. Do not catch it and keep running as if cancellation never happened.

**Interview follow-up:** "Can I use a volatile stop flag instead?" It works for a worker that checks it, but will not by itself wake a thread blocked in `take`, `sleep` or I/O. Use the cancellation mechanism appropriate to the blocking API; not every legacy I/O operation responds identically to interruption.

### `Thread.stop`/`suspend`/`resume` are deprecated for removal

`Thread.stop()` terminates a thread asynchronously mid-operation, which can leave shared objects in a partially-updated, inconsistent state — it can interrupt a monitor-protected update halfway through and release the lock with broken invariants still visible to other threads. `suspend()`/`resume()` can deadlock: a suspended thread holding a lock blocks every other thread that needs that lock, including whatever would call `resume()`. All three are deprecated; use a cooperative flag or `interrupt()` plus a defined cancellation policy instead.

## 8. Deadlock, starvation and livelock

Deadlock: thread A holds lock 1 and waits for lock 2 while thread B holds lock 2 and waits for lock 1. Prevent with consistent lock ordering, smaller lock scope and avoiding external calls while holding locks; timed `tryLock` can support a deliberate failure/retry policy.

**Production symptom:** if enough request workers deadlock or wait behind them, the request queue grows, the pool saturates and callers time out; retries can add more load and spread the incident upstream. Check thread dumps and pool/queue metrics together, stop retry amplification and isolate the dependency, then remove the lock-order cycle. Increasing the pool alone delays saturation rather than fixing the cause.

Starvation: a thread cannot obtain needed progress/resources — for example, a low-priority thread is perpetually passed over, or a fairness-unaware lock keeps favoring the same threads. Livelock: threads keep taking actions but make no useful progress, such as two threads each repeatedly backing off and retrying at the same moment, forever colliding. Sleep-based guesses are not a proof of correctness.

### Detecting deadlock with `ThreadMXBean`

```java
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;

class DeadlockDetector {
    static void reportDeadlocks() {
        ThreadMXBean bean = ManagementFactory.getThreadMXBean();
        long[] deadlockedIds = bean.findDeadlockedThreads();
        if (deadlockedIds == null) {
            System.out.println("No deadlocked threads");
            return;
        }
        ThreadInfo[] infos = bean.getThreadInfo(deadlockedIds, true, true);
        for (ThreadInfo info : infos) {
            System.out.println(info.getThreadName() + " is blocked on " + info.getLockName());
        }
    }
}
```

`findDeadlockedThreads()` detects cycles among monitor and ownable-synchronizer (`java.util.concurrent.locks`) waits; `findMonitorDeadlockedThreads()` covers only monitor locks. A thread dump (`jstack`, or JFR thread-dump events) surfaces the same cycle for a one-off diagnosis without writing detector code.

`ReentrantLock` supports explicit lock/unlock, timed/interruptible acquisition and conditions — see section 13. Unlock in `finally` **after successful acquisition**. A fair-lock setting can affect lock acquisition ordering/throughput; it does not guarantee end-to-end scheduler fairness. Use an actual lock requirement to justify it.

> **Practical takeaway — sections 1–8 vs. 9–15.** Sections 1–8 (JMM, DCL, immutability/safe publication, volatile/CAS, synchronized, lifecycle, deadlock) are the foundations almost no production code writes by hand anymore — everyday concurrent code reaches for the higher-level constructs in sections 9–15 (`ReentrantLock`, `ThreadLocal`, executors, synchronizers, concurrent collections, fork/join, `CompletableFuture`) instead. But those higher-level APIs are only safe to use *without* re-deriving the fundamentals because their guarantees are built on exactly this groundwork — `ConcurrentHashMap`'s visibility, `CompletableFuture` chaining, and pool shutdown semantics all cash out to happens-before, safe publication and immutability underneath. The foundations mainly resurface when something in 9–15 misbehaves and you need to reason about *why*.
>
> **Priority tiers within 9–15, for a senior-dev / solution-engineer level of practical fluency** (not every class needs equal depth):
> - **Must-know** — shows up in almost every real codebase: Executors/thread pools (sizing, bounded queues, rejection policies, graceful shutdown — section 9), `CompletableFuture` (async orchestration, timeouts, exception handling, combining calls — section 10), concurrent collections (`ConcurrentHashMap` atomic compute, `CopyOnWriteArrayList`, `BlockingQueue` producer/consumer — section 11), `ThreadLocal` (request/trace-context propagation and its leak risk in pooled threads — section 12).
> - **Should-know** — comes up periodically, worth being fluent in: `ReentrantLock`/`ReadWriteLock` when intrinsic locks aren't enough (`tryLock`, timed/interruptible acquisition, read-heavy caches — section 13), `CountDownLatch` (startup/shutdown gating) and `Semaphore` (bounding concurrency, rate limiting — section 14).
> - **Nice-to-know** — rarely hand-rolled directly: fork/join (`RecursiveTask`/`RecursiveAction` — mostly invisible, backs parallel streams — section 15), `CyclicBarrier`/`Phaser`/`Exchanger` (niche; know the concept, skip deep practice — section 14), virtual threads (know when they supersede thread-pool tuning — section 16).
>
> Practicing against this tiering — rather than every class in `java.util.concurrent` equally — closes the "never used it in production" gap efficiently: a handful of realistic scenarios (a bounded-pool async batcher with `CompletableFuture` composition and timeout handling, an idempotency cache on `ConcurrentHashMap`, trace-context propagation via `ThreadLocal` across an executor) demonstrate more real-world judgment than classic puzzles (dining philosophers, producer/consumer, ping-pong) that are already covered from the sections 1–8 practice.

## 9. Executors and thread pools

### Foundation: submit tasks to workers instead of starting tasks as threads

A pool contains worker **threads**, which execute submitted **tasks**. Completing a task does not normally destroy the worker; it can execute another task. A queued Runnable is not already a running thread.

| Contract/tool | What it adds |
| --- | --- |
| `Executor.execute(Runnable)` | Submit work without specifying how a thread is acquired; an implementation may even run inline |
| `ExecutorService` | Task submission with futures, lifecycle/shutdown and bulk-execution operations |
| `ScheduledExecutorService` | Delayed/periodic task submission |
| `Future<T>` | Handle for a submitted computation's completion, result, failure or cancellation |
| Concurrent collections | Specified concurrent-access operations, not automatic multi-step business transactions |
| Atomic variables | Atomic operations on their supported state, not arbitrary multi-field invariants |
| Locks/conditions | Explicit coordination when their capabilities fit better than intrinsic monitors |

`execute` does not return a future; `submit` does. For tasks submitted with `submit`, inspect the Future or another explicit error-reporting path: an exception can remain captured even though no uncaught stack trace is printed. Shutdown stops new admissions; it does not mean existing tasks have finished. Await completion when required, and define cancellation/deadline policy rather than relying on JVM exit.

### Evolution: separate work from the thread that runs it

| Version | Addition | Practical shift |
| --- | --- | --- |
| Java 5 | Executors, `Callable`, `Future`, locks, atomics and concurrent collections | Submit tasks rather than manually creating a thread for every job |
| Java 7 | Fork/join framework | Efficient decomposition of suitable CPU tasks, not arbitrary blocking work |
| Java 8 | `CompletableFuture`, parallel streams | Compose results; explicit execution/cancellation policies remain necessary |
| Java 19 | `ExecutorService` became `AutoCloseable` | Resource syntax can manage executor shutdown; close waits for completion |
| Java 21 | Virtual threads standardized after previews in Java 19/20 | High concurrency for suitable blocking workloads without one OS thread per task |

`Runnable` produces no result; `Callable<T>` can return a result and throw checked exceptions. `Future.get()` waits and exposes task failure through `ExecutionException`. Timed get limits that wait, not necessarily the task's execution. `cancel(true)` requests interruption; it cannot force non-cooperative code to stop.

Submitting a task safely publishes prior caller actions to that task, and successfully retrieving its result through `Future.get` provides corresponding visibility back to the caller. You still need synchronization for other concurrent shared mutations.

### The four `Executors` factory pools, and why they are starting points, not defaults

| Factory | Behavior | Caveat |
| --- | --- | --- |
| `newFixedThreadPool(n)` | Fixed number of threads, unbounded `LinkedBlockingQueue` | Queue can grow without limit under sustained overload — "fixed" bounds threads, not memory |
| `newCachedThreadPool()` | Creates threads as needed, reuses idle ones, no queueing (`SynchronousQueue`), idle threads time out after 60s | Can create unbounded threads under a burst — no cap at all |
| `newSingleThreadExecutor()` | One worker thread, unbounded queue, tasks run strictly in submission order | Still just a convenience wrapper; a crashed worker is transparently replaced, but the queue is still unbounded |
| `newScheduledThreadPool(n)` | Fixed-size pool supporting delayed/periodic tasks | Same fixed-rate/fixed-delay caveats as any scheduled executor (see below) |

A fixed thread count is not the same as a bounded system. For platform-thread work, consider an explicitly configured `ThreadPoolExecutor` instead of a factory method, with measured worker limits, a bounded queue and a deliberate rejection policy.

### `ThreadPoolExecutor`: the configuration all four factories wrap

```java
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

class ConfiguredPool {
    static ThreadPoolExecutor create() {
        return new ThreadPoolExecutor(
                4,                                  // core pool size
                8,                                  // maximum pool size
                60L, TimeUnit.SECONDS,               // keep-alive for threads above core size
                new ArrayBlockingQueue<>(100),       // bounded work queue
                new ThreadPoolExecutor.CallerRunsPolicy()); // saturation policy
    }
}
```

Core size threads are kept alive even when idle (unless `allowCoreThreadTimeOut` is set); the pool grows toward the maximum only once the queue is full, and shrinks back toward core size after the keep-alive period of idleness. Sizing guidance:

- **CPU-bound work**: size roughly to available cores (`Runtime.getRuntime().availableProcessors()` plus a small margin), since more threads than cores just adds context-switching overhead.
- **I/O-bound/blocking work**: size can exceed core count, bounded instead by downstream capacity (DB connections, remote service concurrency limits), memory per thread, and acceptable latency — not by CPU count.

### Queueing strategies and saturation policies

| Queue choice | Effect |
| --- | --- |
| Unbounded queue (e.g. `LinkedBlockingQueue` with no capacity) | Maximum pool size is irrelevant — the pool never grows past core size since the queue always has room; memory grows unbounded under sustained overload instead |
| Bounded queue (e.g. `ArrayBlockingQueue(capacity)`) | Pool grows toward maximum once full; once both the queue and the pool are saturated, the configured rejection policy fires |
| `SynchronousQueue` | No storage at all — a submission only succeeds if a worker is immediately available to take it, otherwise the pool must grow or the task is rejected |

When both pool and queue are saturated, `RejectedExecutionHandler` decides what happens to the new task:

| Policy | Behavior |
| --- | --- |
| `AbortPolicy` (default) | Throws `RejectedExecutionException` — caller must handle |
| `CallerRunsPolicy` | Runs the task on the **calling thread**, providing backpressure by slowing the submitter down |
| `DiscardPolicy` | Silently drops the task — rarely appropriate; hides failures |
| `DiscardOldestPolicy` | Drops the queue's oldest waiting task, then retries submission — favors newer work, still silently loses data |

A custom `RejectedExecutionHandler` can log, retry with backoff, or route to a dead-letter mechanism instead of the four built-ins.

### `BoundedExecutor`: admission control via a `Semaphore`

Even an unbounded-queue executor can be given external backpressure by gating submission itself with a counting `Semaphore`, so callers block (or fail fast) before enqueueing more work than the system should admit:

```java
import java.util.concurrent.Executor;
import java.util.concurrent.Semaphore;

class BoundedExecutor implements Executor {
    private final Executor delegate;
    private final Semaphore admission;

    BoundedExecutor(Executor delegate, int maxConcurrentTasks) {
        this.delegate = delegate;
        this.admission = new Semaphore(maxConcurrentTasks);
    }

    @Override
    public void execute(Runnable task) {
        try {
            admission.acquire(); // blocks the caller once maxConcurrentTasks are already admitted
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        try {
            delegate.execute(() -> {
                try {
                    task.run();
                } finally {
                    admission.release();
                }
            });
        } catch (RuntimeException e) {
            admission.release(); // release the permit if delegate.execute itself rejects/throws
            throw e;
        }
    }
}
```

This bounds **submitted-and-not-yet-finished** work, independent of whatever queueing policy the delegate executor uses — useful exactly when you want admission control decoupled from the underlying pool's own queue.

### Avoiding busy-waiting

Polling a flag in a tight loop (`while (!done) { }`) burns CPU and delays the observation of the flag's update under some JIT/CPU-cache conditions. Prefer blocking coordination — `Condition`/`wait`-`notify` (sections 6, 13), a blocking queue, a `CountDownLatch`/`Future` (section 14) — so the waiting thread is descheduled until the real event occurs, or at minimum insert a bounded `Thread.sleep` between poll attempts if blocking APIs genuinely do not fit.

### Scheduled executors: fixed-rate versus fixed-delay

Scheduled executors replace ad hoc sleeping timer threads.

- `scheduleAtFixedRate(task, initialDelay, period, unit)`: attempts to start executions `period` apart, independent of how long each execution took (can "catch up" with back-to-back runs if an execution overran).
- `scheduleWithFixedDelay(task, initialDelay, delay, unit)`: waits `delay` after each execution **finishes** before starting the next — the gap is always observed, the period is not.

An uncaught task exception silently suppresses later periodic executions for that task (no further runs, no further errors printed by default) — catch and log inside the task itself, and surface failure through monitoring rather than assuming the schedule is still healthy.

### Pool sizing failure mode: nested submission to an exhausted pool

**Failure scenario:** every worker submits a child task to the same exhausted pool and blocks waiting for it. No worker remains to run the children — a thread-starvation deadlock, not a lock-based one. Avoid this dependency structure (use a separate pool for the child tasks, or non-blocking composition) rather than simply raising the pool size, which can only postpone the next occurrence.

## 10. `CompletableFuture`

### Creation: `runAsync` and `supplyAsync`

`CompletableFuture.runAsync(Runnable)` runs a side-effecting task and completes with `Void`; `CompletableFuture.supplyAsync(Supplier<T>)` runs a task that produces a result. Both accept an optional `Executor`; without one, they default to `ForkJoinPool.commonPool()` — a pool shared JVM-wide, including by parallel streams and fork/join (section 15), so do not put blocking I/O on it without supplying a dedicated executor; a single blocked task there can starve unrelated work elsewhere in the same JVM.

### Composition, not hidden error recovery

```java
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Supplier;

class CombinedLookup {
    static CompletableFuture<String> load(
            Supplier<String> accountLookup,
            Supplier<String> preferenceLookup,
            Executor executor) {
        var account = CompletableFuture.supplyAsync(accountLookup, executor);
        var preferences = CompletableFuture.supplyAsync(preferenceLookup, executor);
        return account.thenCombine(preferences, (a, p) -> a + ":" + p);
    }
}
```

The caller supplies/owns the executor; each supplier must have its own appropriate dependency timeout. The returned future fails if a required lookup fails. Adding `exceptionally(error -> "")` would instead turn that failure into a blank success-looking result unless that is an explicit degraded contract.

### `thenApply` versus `thenCompose`/`thenCombine`, and callback threading

- `thenApply(Function)`: transforms a result in place — use when the next step is a plain synchronous computation.
- `thenAccept(Consumer)`/`thenRun(Runnable)`: consume the result (or just react to completion) without producing a new value.
- `thenCompose(Function<T, CompletableFuture<U>>)`: flattens a callback that itself returns another `CompletableFuture` — the async equivalent of `flatMap`, avoiding a nested `CompletableFuture<CompletableFuture<U>>`.
- `thenCombine(other, BiFunction)`: joins two independent futures' results once both complete.

Non-async callback variants (`thenApply`, `thenAccept`, ...) may run on whichever thread completes the preceding stage — potentially the thread that called `complete()`, not necessarily the original executor's thread. The `Async` variants (`thenApplyAsync`, ...) run on the specified executor, or the default async facility (`ForkJoinPool.commonPool()`) if none is given. Choose the `Async` form whenever the callback itself does non-trivial or blocking work, so it does not run inline on an arbitrary completing thread.

### Error handling and terminal retrieval

`join()` propagates failures through unchecked `CompletionException`; `get()` uses checked `ExecutionException`/`InterruptedException`. Java 9 added timeout helpers such as `orTimeout`; completing a future exceptionally on timeout does not guarantee the underlying network request stops — `CompletableFuture.cancel(true)` itself does not interrupt the underlying computation the way an ordinary interruptible task's `Future.cancel(true)` might.

## 11. Concurrent collections

"Synchronized" collections (`Collections.synchronizedList/Map(...)`, legacy `Vector`/`Hashtable`) wrap every individual method in a single lock — correct for single-operation safety, but **compound actions still race** (check-then-act, iterate-while-modify) unless the caller holds the same lock externally for the whole compound operation, and that single lock serializes all access, including concurrent reads.

"Concurrent" collections (`java.util.concurrent`) are designed from the ground up for concurrent access with finer-grained or lock-free internals, and typically expose atomic compound operations directly on the interface instead of requiring external locking.

### Iteration and concurrent updates

Plain collections (`ArrayList`, `HashMap`) use **fail-fast** iterators: a structural modification during iteration (by any thread, or even the same thread outside the iterator) throws `ConcurrentModificationException` on a best-effort basis — this is a bug-detection aid, not a concurrency guarantee, and is not reliable under true concurrent access. Concurrent collections generally use **weakly consistent** iterators instead: they tolerate concurrent modification without throwing, and may or may not reflect modifications made after the iterator was created, but never throw and never repeat/skip an element inconsistently with the collection's own internal consistency.

### `ConcurrentHashMap`

Supports fully concurrent reads and a high degree of concurrent write throughput via internal fine-grained synchronization (bucket/segment-level, implementation-dependent across versions), never locking the entire map for a single `get`/`put`. It also exposes atomic compound operations directly, avoiding the check-then-act races a synchronized `Map` still has:

```java
import java.util.concurrent.ConcurrentHashMap;

class Counters {
    private final ConcurrentHashMap<String, Integer> counts = new ConcurrentHashMap<>();

    void increment(String key) {
        counts.merge(key, 1, Integer::sum); // atomic read-modify-write; no external lock needed
    }

    int getOrZero(String key) {
        return counts.getOrDefault(key, 0);
    }
}
```

`putIfAbsent`, `computeIfAbsent`, `merge` and `replace` are all atomic compound operations — reach for these instead of `containsKey` + `put` pairs, which are not atomic even on a concurrent map (the atomicity comes from using the compound method, not merely from the map being "concurrent").

### `CopyOnWriteArrayList` / `CopyOnWriteArraySet`

Every mutation (`add`, `remove`, `set`) copies the entire underlying array. Reads never block and iterators never throw `ConcurrentModificationException` — an iterator simply reflects a stable snapshot taken at its creation and never observes later mutations. This makes it a strong fit for **read-heavy, write-rare** scenarios such as a listener list that is iterated far more often than it is modified; it is a poor fit when writes are frequent, since each write is O(n) in list size.

### `ConcurrentSkipListMap` / `ConcurrentSkipListSet`

A concurrent, sorted analogue to `TreeMap`/`TreeSet`, backed by a skip list rather than a red-black tree, giving `O(log n)` expected-time operations with full concurrent-access safety and weakly-consistent iteration/navigation (`firstKey`, `ceilingKey`, etc.) — useful when both concurrent access and sorted/navigable order are required together, which `ConcurrentHashMap` does not provide.

## 12. `ThreadLocal`

`ThreadLocal<T>` gives each thread its own independent copy of a value, with no sharing and therefore no synchronization needed to use it. Each `Thread` actually holds a small per-thread map (`ThreadLocalMap`) keyed by the `ThreadLocal` instance; `get()`/`set()` operate on that thread's own entry.

```java
class RequestContext {
    private static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();

    static void setUser(String user) {
        CURRENT_USER.set(user);
    }

    static String currentUser() {
        return CURRENT_USER.get();
    }

    static void clear() {
        CURRENT_USER.remove(); // essential in pooled-thread environments
    }
}
```

Typical uses: per-thread `SimpleDateFormat`/`DecimalFormat` instances (not thread-safe to share), per-request security/transaction context in a web container, per-thread random-number generators (`ThreadLocalRandom`, which avoids `Random`'s CAS contention under concurrent use).

### `InheritableThreadLocal`

`InheritableThreadLocal<T>` copies the parent thread's value into a child thread **at the moment the child is created**, via an overridable `childValue()` hook. Later changes to the parent's value are not retroactively propagated to already-created children.

### Pitfalls: memory leaks in pooled environments

In a thread pool, threads are long-lived and reused across many logical tasks. If a task sets a `ThreadLocal` value and never calls `remove()`, that value (and anything it references) stays attached to the pooled thread indefinitely — a classic memory leak, and in web containers that reuse request-handling threads, a potential **cross-request data leak** where one user's context bleeds into the next request handled by the same thread. Always `remove()` in a `finally` block once the thread-confined value is no longer needed, and never assume a worker thread "starts fresh" just because a new task began.

## 13. Explicit locks: `ReentrantLock`, `ReadWriteLock` and `Condition`

### `ReentrantLock` versus intrinsic (`synchronized`) locks

`ReentrantLock` offers capabilities intrinsic locks do not: a timed/interruptible `tryLock`, an optional fairness policy, and multiple `Condition` objects per lock. It is reentrant, like intrinsic locks. Unlike `synchronized`, it is **not released automatically** — always pair acquisition with `finally`:

```java
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.TimeUnit;

class Account {
    private final ReentrantLock lock = new ReentrantLock();
    private int balance;

    boolean withdraw(int amount) throws InterruptedException {
        if (!lock.tryLock(500, TimeUnit.MILLISECONDS)) {
            return false; // could not acquire in time; avoids an unbounded wait/deadlock
        }
        try {
            if (balance < amount) {
                return false;
            }
            balance -= amount;
            return true;
        } finally {
            lock.unlock();
        }
    }
}
```

Default `ReentrantLock` construction is unfair (higher throughput, can starve long-waiting threads under contention); `new ReentrantLock(true)` requests approximate FIFO fairness at a throughput cost. Reach for `ReentrantLock` only when a concrete capability (timeout, interruptibility, multiple conditions, non-block-structured locking) is actually needed — plain mutual exclusion is simpler and less error-prone with `synchronized`.

### `ReadWriteLock`: many readers, one writer

`ReentrantReadWriteLock` separates a read lock (shared among any number of readers, as long as no writer holds the write lock) from a write lock (exclusive against both readers and other writers). This helps when reads vastly outnumber writes on data that is expensive to recompute:

```java
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantReadWriteLock;

class Cache<K, V> {
    private final Map<K, V> data = new HashMap<>();
    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();

    V get(K key) {
        rwLock.readLock().lock();
        try {
            return data.get(key);
        } finally {
            rwLock.readLock().unlock();
        }
    }

    void put(K key, V value) {
        rwLock.writeLock().lock();
        try {
            data.put(key, value);
        } finally {
            rwLock.writeLock().unlock();
        }
    }
}
```

If writes are frequent or the critical section is cheap, the bookkeeping overhead of a read/write lock can cost more than it saves versus a plain `ReentrantLock`, or a ready-made `ConcurrentHashMap` (section 11).

### `Condition`: multiple wait-sets per lock

A `Condition` (from `lock.newCondition()`) plays the role of `wait`/`notify`/`notifyAll`, but scoped to a `ReentrantLock` and allowing several independent conditions on the same lock — useful when, for example, a bounded buffer needs a separate "not full" and "not empty" condition rather than one shared wait-set where every `notifyAll` wakes unrelated waiters:

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

class BoundedBuffer<T> {
    private final Deque<T> items = new ArrayDeque<>();
    private final int capacity;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    BoundedBuffer(int capacity) {
        this.capacity = capacity;
    }

    void put(T item) throws InterruptedException {
        lock.lock();
        try {
            while (items.size() == capacity) {
                notFull.await();
            }
            items.addLast(item);
            notEmpty.signal();
        } finally {
            lock.unlock();
        }
    }

    T take() throws InterruptedException {
        lock.lock();
        try {
            while (items.isEmpty()) {
                notEmpty.await();
            }
            T item = items.removeFirst();
            notFull.signal();
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```

`await()`/`signal()`/`signalAll()` must be called while holding the associated lock, exactly like `wait`/`notify` must hold the monitor — the same spurious-wakeup `while` loop discipline applies. `java.util.concurrent.ArrayBlockingQueue`/`LinkedBlockingQueue` already implement this pattern; write one by hand only as a learning exercise or when no existing blocking collection fits.

### Where this shows up in practice

- **`ReentrantLock`** earns its place over `synchronized` when you need `tryLock(timeout)` to fail fast instead of blocking indefinitely — e.g. a cache-refresh guard where losing the race to refresh just means "someone else is already refreshing, serve the stale value" rather than queuing behind them — or when the lock/unlock pair has to span a boundary a `synchronized` block can't express (acquired in one method, released in a callback/different method).
- **`ReadWriteLock`** fits a configuration/feature-flag cache almost exactly: reads happen on every request, writes (reload) happen rarely on a timer or webhook. `ReadWriteLock` lets all the concurrent reads proceed uncontended while a reload briefly excludes them, instead of a single exclusive lock serializing every request through every reload.
- **`Condition`** shows up more in library/infrastructure code than application code — most teams reach for `ArrayBlockingQueue`/`LinkedBlockingQueue` instead of hand-rolling the bounded buffer above. It's worth knowing because it's exactly what those classes (and custom connection pools / custom executors) use internally, not because you'll often write one directly.

## 14. Synchronizers: `CountDownLatch`, `CyclicBarrier`, `Phaser`, `Exchanger`, `Semaphore`

These "synchronizer" utilities coordinate groups of threads around a shared event, distinct from locks (which coordinate access to shared state).

| Tool | Shape | Reusable? | Typical use |
| --- | --- | --- | --- |
| `CountDownLatch` | N threads count down; any number of threads can await the count reaching zero | No — fires once | Wait for N startup tasks, or N workers, to finish before proceeding |
| `CyclicBarrier` | N threads each call `await()`; all are released together once all N have arrived | Yes — resets automatically for reuse | Repeated phases where every participant must finish phase *k* before any starts phase *k+1* |
| `Phaser` | Generalizes `CyclicBarrier`: parties can register/deregister dynamically, supports tiered/hierarchical phasing | Yes | Variable-size cohorts across multiple phases, e.g. a dynamically sized worker set |
| `Exchanger` | Exactly two threads rendezvous and swap objects | Yes | Producer/consumer handoff of a buffer pair (double-buffering) |
| `Semaphore` | A counting permit pool; `acquire()`/`release()` | Yes | Limit concurrent access to a resource pool (connections, admission control, section 9's `BoundedExecutor`) |
| `thread.join()` | One thread waits for exactly one other named thread to terminate | N/A | Simplest case; not a general synchronizer, just a Thread API |

### `CountDownLatch` versus `join()`

`thread.join()` requires holding a reference to the exact `Thread` object and only reports termination, not an arbitrary custom milestone. `CountDownLatch` lets any number of participants signal readiness/completion of a logical step (not necessarily "thread terminated") and lets any number of other threads wait for that step, without each waiter needing a reference to every worker thread.

```java
import java.util.concurrent.CountDownLatch;

class StartupGate {
    static void awaitAllReady(int workerCount, Runnable work) throws InterruptedException {
        CountDownLatch ready = new CountDownLatch(workerCount);
        CountDownLatch start = new CountDownLatch(1);
        for (int i = 0; i < workerCount; i++) {
            new Thread(() -> {
                ready.countDown();          // signal "I'm initialized"
                try {
                    start.await();           // wait for the starter's go-ahead
                    work.run();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }).start();
        }
        ready.await();  // wait until every worker has initialized
        start.countDown(); // release everyone at once
    }
}
```

### `CyclicBarrier`: the theater-curtain analogy

Think of actors backstage before a scene: each actor signals "I'm in position" (`await()`), and the curtain only rises once every actor has done so — then all are released together and the barrier immediately resets for the next scene. A `CyclicBarrier` can optionally run a single "barrier action" (e.g., merging per-thread partial results) exactly once when the last party arrives, before releasing everyone:

```java
import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.CyclicBarrier;

class PhaseRunner {
    static CyclicBarrier barrier(int parties) {
        return new CyclicBarrier(parties, () -> System.out.println("Phase complete; merging results"));
    }

    static void runPhase(CyclicBarrier barrier) throws InterruptedException, BrokenBarrierException {
        // ... do this phase's work ...
        barrier.await(); // blocks until all `parties` threads have called await()
    }
}
```

If any participant is interrupted or times out while waiting, the barrier becomes **broken**: every other waiting thread immediately receives `BrokenBarrierException`, since the all-or-nothing guarantee can no longer be honored.

### `Phaser` versus `CountDownLatch`/`CyclicBarrier`

A `Phaser` supports a dynamically changing number of participants (`register()`/`bulkRegister()`/`arriveAndDeregister()`), and supports tiered phasers for large party counts to reduce contention on a single barrier. Reach for it only when `CountDownLatch`/`CyclicBarrier` cannot express the needed dynamic registration — it is considerably more complex to use correctly.

### `Exchanger`: pairwise handoff

```java
import java.util.concurrent.Exchanger;

class DoubleBuffering {
    private final Exchanger<int[]> exchanger = new Exchanger<>();

    void producer(int[] fillBuffer) throws InterruptedException {
        // fill fillBuffer with data, then hand it to the consumer and receive an empty one back
        int[] empty = exchanger.exchange(fillBuffer);
        // reuse `empty` for the next round
    }

    void consumer(int[] emptyBuffer) throws InterruptedException {
        int[] full = exchanger.exchange(emptyBuffer);
        // process `full`, then hand the now-empty buffer back next round
    }
}
```

`exchange()` blocks until the other party also calls `exchange()`; exactly two threads participate per `Exchanger` instance.

### `Semaphore` as a counting permit pool, and mutex versus semaphore

A `Semaphore` initialized with `n` permits allows up to `n` concurrent acquirers; a `Semaphore(1)` used purely for mutual exclusion is a **binary semaphore**, functionally close to a mutex but with one key difference: an ordinary mutex/lock has **ownership** — only the thread that acquired it may release it, and most mutex implementations are reentrant for that owning thread. A semaphore has no ownership concept: any thread may call `release()`, including one that never called `acquire()`, which makes it suitable for producer/consumer signaling (not just mutual exclusion) but also easier to misuse accidentally.

### Where this shows up in practice

Honest answer: of these five, **`Semaphore`** is the one with a clear, common real use — the rest range from occasional to genuinely rare in typical backend work.

- **`Semaphore`**: admission control / rate limiting into a constrained resource — capping concurrent DB connections, or concurrent calls into a slow/rate-limited external API. This is exactly the `BoundedExecutor` pattern from section 9 and the portfolio-valuation fix in 19.4 (a `Semaphore` capping concurrency into the legacy pricing service while batching reduced raw call volume).
- **`CountDownLatch`**: a startup/readiness gate — don't let the load balancer mark an instance healthy (or don't accept traffic) until N startup tasks have all completed (DB connection warm-up, cache preload, connecting to M downstream dependencies). Also common in tests, to hold several worker threads at a start line before releasing them together.
- **`CyclicBarrier`**: rarer in production web/enterprise code than `CountDownLatch`. The realistic uses are (a) deliberately synchronizing N test threads to hit a race window at the same instant when writing a concurrency test, or (b) phase-based batch jobs where every worker must finish phase N (e.g. extract) before any worker starts phase N+1 (e.g. transform) — and even then, most teams model phases as separate stages/jobs rather than an in-process barrier.
- **`Phaser`**: generalizes `CyclicBarrier`/`CountDownLatch` with a dynamically-changing party count and reusable phases, but most real systems don't need that flexibility. This is more of a "know it exists and what problem it solves" interview answer than something you'll reach for in day-to-day code.
- **`Exchanger`**: niche. The textbook use is double-buffering — one thread fills a buffer while another drains the previously-filled one, swapping on each round — seen occasionally in data-pipeline/producer-consumer designs, but most teams use a `BlockingQueue` instead since it isn't restricted to exactly two threads and handles backpressure more naturally.

### Testing concurrency: safety versus progress

**Scenario:** two requests reserve the last seat. A passing single-threaded test says nothing about the collision. Use a latch or barrier to bring workers to a controlled starting point, run both operations, and assert the **safety** invariant: at most one reservation commits and the persisted state remains valid. A start gate increases contention; it does not force both threads through the same internal read/write interleaving. When that interleaving matters, use a controlled test seam at the relevant point, without adding synchronization that accidentally eliminates the race.

Check **liveness** separately: wait for all tasks with a bounded timeout, propagate worker exceptions to the test, and always release gates and shut down the executor in cleanup. A timeout is a diagnostic failure, not proof of deadlock; inspect thread dumps and distinguish an overloaded test environment from a real lack of progress. Avoid `sleep()` as an ordering mechanism. Repeat a stress test across schedules and use a tool such as OpenJDK `jcstress` for Java Memory Model outcomes; passing finite runs does not prove all interleavings safe.

## 15. The fork/join framework

Fork/join (Java 7) decomposes a problem recursively into smaller subtasks until a threshold is reached, computes the small pieces directly, and combines results back up — suited to CPU-bound, recursively divisible work (sorting, parallel sums, certain parallel-stream operations under the hood), not arbitrary blocking I/O work.

### Work-stealing

`ForkJoinPool` gives each worker thread its own double-ended task queue. A worker pushes/pops its own subtasks from one end (LIFO, favoring cache locality for its own recently-created work); when a worker's queue empties, it **steals** work from the *other* end of another worker's queue (FIFO, taking the oldest/largest-grained task to reduce further stealing). This keeps all workers busy without a shared central queue becoming a contention point.

### `RecursiveTask<V>` and `RecursiveAction`

```java
import java.util.concurrent.RecursiveTask;
import java.util.concurrent.ForkJoinPool;

class ParallelSum extends RecursiveTask<Long> {
    private static final int THRESHOLD = 10_000;
    private final long[] values;
    private final int start;
    private final int end;

    ParallelSum(long[] values, int start, int end) {
        this.values = values;
        this.start = start;
        this.end = end;
    }

    @Override
    protected Long compute() {
        if (end - start <= THRESHOLD) {
            long sum = 0;
            for (int i = start; i < end; i++) {
                sum += values[i];
            }
            return sum;
        }
        int mid = (start + end) >>> 1;
        ParallelSum left = new ParallelSum(values, start, mid);
        ParallelSum right = new ParallelSum(values, mid, end);
        left.fork();                 // schedule left asynchronously
        long rightResult = right.compute(); // compute right on this thread
        long leftResult = left.join();      // wait for left's result
        return leftResult + rightResult;
    }

    static long sum(long[] values) {
        return ForkJoinPool.commonPool().invoke(new ParallelSum(values, 0, values.length));
    }
}
```

`RecursiveTask<V>` returns a result; `RecursiveAction` does not (used for side-effecting work such as in-place parallel sort). The `fork()`-one-side / `compute()`-the-other-side / `join()` pattern avoids forking both halves, which would waste a task submission on work the current thread could just run directly. `ForkJoinPool.commonPool()` is shared JVM-wide (including by parallel streams); a pinned/blocking task on the common pool can starve unrelated parallel-stream work elsewhere in the same JVM.

### Where this shows up in practice

Hand-written `RecursiveTask`/`RecursiveAction` subclasses are uncommon in typical business/web backends — those are mostly I/O-bound (DB calls, HTTP calls), which is precisely the workload fork/join is *not* suited for. Where it actually shows up:

- **Indirectly, constantly**: `Arrays.parallelSort()` and `Stream.parallel()` are implemented on top of the common `ForkJoinPool`, so most developers use fork/join every time they reach for a parallel stream without ever touching `RecursiveTask` directly.
- **Directly, occasionally**: genuine in-memory, CPU-bound divide-and-conquer work over large arrays/matrices — numeric computation, image/tile processing, batch aggregation over data already fully loaded in memory — where the dataset is large enough that splitting it recursively and running pieces on multiple cores pays for itself.
- **The real-world caution worth stating unprompted** (a frequently-cited production gotcha): never route I/O-bound or blocking work through `parallelStream()`/fork-join. Because `ForkJoinPool.commonPool()` is shared JVM-wide, one blocking task parked there (e.g. a parallel stream calling a slow REST client per element) can starve *unrelated* parallel-stream work elsewhere in the same process — the same thread-starvation failure mode as section 9's pool-sizing discussion and the 19.3 fan-out story, just surfacing through the common pool instead of an explicit `Executor`.

## 16. Virtual threads (Java 21)

Virtual threads are scheduled by the runtime onto carrier platform threads. For many supported blocking operations, waiting can unmount a virtual thread so the carrier runs other work. Existing platform threads remain; Java 21 does not silently convert every existing executor or application server to virtual threads.

Use them for many mostly-waiting tasks when the libraries and workload fit. Do not pool virtual threads merely to reuse them; normally use a new virtual thread per task. **Still bound scarce resources and admitted work**: thousands of lightweight threads can still retain too much request data or overwhelm twenty DB connections.

```java
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;

class VirtualLookups {
    static List<String> fetchAll(List<Callable<String>> lookups, int limit)
            throws InterruptedException, ExecutionException {
        if (limit <= 0) {
            throw new IllegalArgumentException("limit must be positive");
        }
        var permits = new Semaphore(limit);
        var futures = new ArrayList<Future<String>>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                for (var lookup : lookups) {
                    futures.add(executor.submit(() -> {
                        permits.acquire();
                        try {
                            return lookup.call();
                        } finally {
                            permits.release();
                        }
                    }));
                }
                var results = new ArrayList<String>();
                for (var future : futures) {
                    results.add(future.get());
                }
                return results;
            } finally {
                for (var future : futures) {
                    future.cancel(true);
                }
            }
        }
    }
}
```

This limits concurrent lookup bodies **per invocation** and preserves input order in the returned list. The lookup must define its own timeout/cancellation behavior. The finally block requests cancellation of unfinished siblings after failure/interruption, and executor close waits for termination; this is not a hard end-to-end deadline if a task ignores interruption.

**Scope matters:** separate calls each create a separate semaphore, so this is not a service-wide or distributed limit. For a service-wide dependency budget, share the limiter at the appropriate lifecycle scope.

### Java 21-specific caveats

| Concern | Java 21 guidance |
| --- | --- |
| CPU-bound computation | Virtual threads do not add CPU cores; use measured CPU parallelism |
| Pinning | Blocking while inside a synchronized region, or certain native/foreign calls, can pin a virtual thread to its carrier |
| Lock choice | Keep locks short; for frequent long blocking operations under a monitor, investigate pinning and an appropriate `ReentrantLock` redesign rather than replacing every synchronized block |
| ThreadLocal state | Supported, but per-thread large caches become costly with many virtual threads; pooled platform threads also require request-context cleanup |
| DB/HTTP capacity | Connection pools, rate limits and admission control still govern real throughput |
| JVM lifetime | Virtual threads are daemon threads; ensure the application waits for required work instead of exiting after launch |
| Observability | Use supported thread dumps/JFR, latency/queue metrics and pinning diagnostics; do not assume platform-thread counts describe all virtual work |

Thread-local request/security context does not automatically propagate correctly across arbitrary async boundaries. Define propagation and cleanup; `InheritableThreadLocal` is not a universal solution for pooled executors.

**Preview boundary:** structured concurrency and scoped values are preview features in Java 21. They can be discussed as emerging tools, but are not stable APIs assumed by this guide and require explicit preview opt-in.

## 17. Practice problems checklist

A self-check list, not full worked solutions — implement each to confirm the mechanism, not just the vocabulary, before an interview.

### Core thread coordination

- Alternate output between two threads (ping-pong) using `wait`/`notify` or a `Condition`.
- Print numbers 1..N alternating even/odd between two threads.
- Implement a bounded producer-consumer buffer by hand with `wait`/`notify`, then again with `ReentrantLock`/`Condition`, then again with `BlockingQueue` — compare the three.
- Dining philosophers: demonstrate the naive deadlock, then fix it with consistent lock ordering or a resource-limiting `Semaphore`.
- Demonstrate `ReentrantLock` with `tryLock(timeout)` backing off instead of deadlocking.

### Thread pools and fork/join

- Compute parallel sum/min/max over a large array with `RecursiveTask`, and compare the threshold's effect on performance.
- Parallel matrix multiplication decomposed with fork/join.
- Implement `BoundedExecutor` (section 9) and demonstrate it rejecting/blocking once the limit is reached.
- FizzBuzz using four threads, each responsible for one condition, coordinated so output stays in order.

### Synchronizers and simulations

- Water-molecule simulation: coordinate threads representing H and O atoms so they only "bond" in groups of 2 H + 1 O, using a barrier or semaphore pair.
- Monte Carlo estimation of π using multiple threads each sampling random points, aggregating with an atomic counter or `CompletableFuture.thenCombine`.
- Restaurant simulation: waiters (producers) submit orders to a bounded queue; cooks (consumers) process them; use `CountDownLatch` to signal "kitchen closed, drain remaining orders then stop."

### Memory model and lifecycle

- Reproduce the broken double-checked locking idiom's visibility bug (section 3) under a stress harness, then fix it two ways.
- Demonstrate a `ThreadLocal` leak in a fixed-size pool by never calling `remove()`, then observe it fixed.
- Write a test that deliberately triggers a deadlock and detect it with `ThreadMXBean` (section 8).

## 18. Worked examples: Must-know tier in realistic shape

These three cover the Must-know tier called out in the section 8/9 takeaway — not academic puzzles, but the shape of code that actually shows up in services. Each is deliberately compact; the point is the pattern, not production polish (no logging/metrics wiring, minimal error taxonomy).

### 18.1 Bounded-pool async batcher with `CompletableFuture` composition and timeout

A common integration shape: fan out N downstream calls on a bounded pool, combine the results, and bound the whole batch with a timeout instead of letting a single slow call stall everything.

```java
class AsyncBatcher {
    private final ExecutorService pool;

    AsyncBatcher(int poolSize) {
        // bounded queue + caller-runs: back-pressure instead of unbounded memory growth
        this.pool = new ThreadPoolExecutor(
                poolSize, poolSize, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(100),
                new ThreadPoolExecutor.CallerRunsPolicy());
    }

    List<String> fetchAll(List<String> ids, Duration perCallTimeout, Duration batchTimeout) {
        List<CompletableFuture<String>> futures = ids.stream()
                .map(id -> CompletableFuture
                        .supplyAsync(() -> callDownstream(id), pool)
                        .orTimeout(perCallTimeout.toMillis(), TimeUnit.MILLISECONDS)
                        .exceptionally(ex -> "FALLBACK:" + id)) // per-call failure never kills the batch
                .toList();

        CompletableFuture<Void> all = CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]));
        try {
            all.get(batchTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            // batch-level ceiling: stop waiting, take whatever already completed
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
        }
        return futures.stream()
                .map(f -> f.getNow("TIMED_OUT")) // never blocks further; completed value or sentinel
                .toList();
    }

    private String callDownstream(String id) { /* real I/O here */ return "value-" + id; }

    void shutdown() { pool.shutdown(); }
}
```

What this is actually exercising: `supplyAsync` running on a *bounded* pool (not `commonPool()`, which is shared and easy to starve), `orTimeout` for a per-call ceiling, `exceptionally` to keep one bad call from poisoning `allOf`, and a separate outer timeout so the batch as a whole has a bound even if `allOf` would otherwise wait indefinitely. `getNow` is the key trick for "best effort after a timeout" — it never blocks.

### 18.2 `ConcurrentHashMap`-based idempotency cache

A common need at an API boundary: given a request/idempotency key, make sure a handler runs at most once concurrently per key, and repeated/concurrent callers with the same key get the same result instead of duplicating the side effect.

```java
class IdempotencyCache<K, V> {
    private final ConcurrentMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    V execute(K key, Supplier<V> handler) {
        // computeIfAbsent is atomic per key: only the first caller for a given key runs the handler;
        // concurrent callers with the same key get the same in-flight future.
        CompletableFuture<V> future = inFlight.computeIfAbsent(key,
                k -> CompletableFuture.supplyAsync(handler));
        try {
            return future.join();
        } finally {
            // remove only once this particular future has finished, so a late caller after
            // completion recomputes instead of being pinned to a stale cached value forever
            future.whenComplete((v, ex) -> inFlight.remove(key, future));
        }
    }
}
```

The subtlety worth internalizing: `computeIfAbsent`'s atomicity is what prevents the classic "read-then-write" race (two threads both see no entry, both run the handler). The supplier passed to `computeIfAbsent` must be cheap and non-blocking relative to map locking — here it only *schedules* the real work via `supplyAsync` rather than running it inline, so the per-bucket lock isn't held for the duration of the actual handler.

### 18.3 `ThreadLocal` trace-context propagation across an executor

The leak/correctness trap from section 12 in its most common real form: a trace or tenant ID set via `ThreadLocal` on the calling thread does **not** automatically follow work submitted to an executor, because pooled worker threads are reused and were never part of the calling thread's call stack.

```java
class TraceContext {
    private static final ThreadLocal<String> TRACE_ID = new ThreadLocal<>();

    static String get() { return TRACE_ID.get(); }
    static void set(String id) { TRACE_ID.set(id); }
    static void clear() { TRACE_ID.remove(); } // mandatory on a pooled thread — see section 12
}

class TracePropagatingExecutor {
    private final ExecutorService delegate;

    TracePropagatingExecutor(ExecutorService delegate) { this.delegate = delegate; }

    <T> CompletableFuture<T> submit(Supplier<T> task) {
        String capturedTraceId = TraceContext.get(); // snapshot on the *submitting* thread
        return CompletableFuture.supplyAsync(() -> {
            String previous = TraceContext.get(); // pooled thread may carry a stale value from a prior task
            TraceContext.set(capturedTraceId);
            try {
                return task.get();
            } finally {
                if (previous == null) {
                    TraceContext.clear();
                } else {
                    TraceContext.set(previous); // restore, don't just clear, if nesting is possible
                }
            }
        }, delegate);
    }
}
```

Without the capture-on-submit/restore-on-completion dance, two failure modes show up in production: either the trace ID is silently `null` inside the task (context didn't propagate), or a worker thread leaks the previous task's trace ID into the next task that happens to run on the same pooled thread (context bled across requests). This is also exactly why frameworks ship a `ScopedValue` (Java 21+) or an executor-wrapping propagation utility instead of asking every call site to do this by hand.

## 19. Real-world interview stories

Four grounded answers for "tell me about a concurrency problem you solved," each following the same shape: context → what was used → what went wrong → the fix → a trade-off to mention if probed further. All four reuse the same two building blocks from earlier in this guide — the bounded-pool `CompletableFuture` fan-out from section 10/18.1 and the `Semaphore`-based admission control from section 9's `BoundedExecutor` — so they read as one coherent mental model rather than four unrelated anecdotes.

### 19.1 AI outbound-calling app: post-call fan-out on `CompletableFuture`

**Context.** After an automated post-discharge call ended, three independent follow-up steps had to run: persist the transcript, trigger summarization, and notify the care team.

**What was used.** `CompletableFuture.runAsync`/`supplyAsync` to fan the three steps out concurrently instead of running them sequentially on the call-handling thread.

**What went wrong.** The fan-out ran on the default common `ForkJoinPool`. Under load, other unrelated parallel-stream/`CompletableFuture` work in the same JVM shared that same pool (see section 5's "common-pool contention" note), so post-call tasks queued behind unrelated work — occasionally stalling long enough to miss an SLA. Separately, an unhandled exception in one step (e.g., summarization service down) silently killed just that step with no visible failure, and the call's trace/correlation ID set via `ThreadLocal` on the calling thread did not propagate into the async tasks (the exact trap in 18.3), so failures were nearly impossible to correlate back to a specific call in logs.

**The fix.** A dedicated bounded executor for post-call work, isolated from the shared common pool; `.exceptionally()`/`.handle()` on each step so one failure doesn't vanish silently; `orTimeout()` per step so a hung downstream call doesn't hold a worker thread indefinitely; and explicit capture/restore of the trace ID across the executor boundary (section 18.3's pattern) so every async step's logs still carried the originating call ID.

**Trade-off if probed.** Isolating the pool costs a bit of resource overhead (a second pool to size and monitor) in exchange for blast-radius containment — a slow summarization service can no longer stall transcript persistence or vice versa.

### 19.2 Banking app: synchronous by design, with a proposed concurrent improvement

**Context.** A funds-transfer flow called out to a credit-check service and a fraud-check service before committing the transfer.

**What was used.** Both calls were made synchronously, one after the other, inside the transaction boundary — a deliberate choice, not an oversight.

**Why synchronous was the right starting call.** The two checks fed directly into a commit/abort decision with strict ordering and auditability requirements; introducing concurrency here would have added failure-mode complexity (partial completion, reconciling two independent outcomes under a timeout) for a path where correctness and traceability mattered more than shaving tens of milliseconds off a call that was already well within its SLA.

**The proposed improvement, when asked "how would you speed this up."** Since credit-check and fraud-check are independent reads with no ordering dependency, fan them out with `CompletableFuture.supplyAsync` on a bounded pool, each with its own `orTimeout()` and an `.exceptionally()` fallback (e.g., treat a timed-out fraud check as "manual review required" rather than silently approving), then `thenCombine` the two outcomes before the commit decision.

**Trade-off if probed.** This only pays off if the two checks are genuinely independent and a partial/timeout result has a safe, well-defined fallback (manual review, not silent approval) — concurrency should never be introduced into a money-movement path just because it's possible; it has to come with an explicit, auditable degradation story.

### 19.3 Aggregated account view: fan-out without a timeout starved the pool

**Context.** A dashboard aggregated balances from internal bank accounts plus externally authorized/onboarded accounts at other banks (several partner integrations).

**What was used.** One `CompletableFuture.supplyAsync` call per account source, combined with `CompletableFuture.allOf`.

**What went wrong.** No per-call timeout was set. When one partner bank's API degraded (slow responses, not outright down), every request touching that partner held a worker thread indefinitely. Because the fan-out shared the same pool as other request handling, one degraded partner was enough to exhaust the pool and stall the dashboard for *all* users, not just the ones with an account at that partner — the thread-starvation failure mode from section 9's pool-sizing discussion, but triggered by an external dependency instead of a local bug.

**The fix.** Per-source `orTimeout()` so one slow partner can't hold a thread past a bound; a dedicated bounded executor for account aggregation, isolated from the pool handling other requests (same isolation principle as 19.1); `.exceptionally()` per source to assemble a partial result (the sources that responded) instead of failing the whole aggregation; and, conceptually, a circuit breaker per partner so a partner already known to be down fails fast instead of queuing more timed-out calls, with the UI showing a staleness-flagged cached balance for that source.

**Trade-off if probed.** This is also where the idempotent-read versus money-movement-retry distinction matters: retrying a balance *read* after a timeout is safe to do liberally, but the same aggressive-retry instinct applied to a *transfer* call would need idempotency keys and much more care — worth stating explicitly to show the distinction is deliberate, not accidental.

### 19.4 Portfolio valuation across instruments: naive fan-out hit provider rate limits

**Context.** Portfolio valuation needed current prices/values across many instrument types (equities, bonds, funds, etc.), each potentially served by a different pricing provider.

**What was used.** Initially, one `CompletableFuture.supplyAsync` per instrument held in the portfolio.

**What went wrong.** For a large portfolio this meant hundreds of concurrent per-instrument calls to the same handful of providers. At scale this triggered provider-side rate limiting (429s) and put sustained pressure on a slower legacy valuation service that a few instrument types still depended on — the problem wasn't thread exhaustion this time, it was overwhelming an external dependency's own capacity.

**The fix.** Re-batched the fan-out to one call per instrument type/provider (using each provider's batch endpoint) instead of one call per instrument, cutting call volume by orders of magnitude; a `Semaphore` specifically capping concurrency into the slower legacy service — a direct reuse of the `BoundedExecutor` admission-control pattern from section 9, applied per downstream dependency rather than per pool; and a fallback to the last cached valuation with an explicit "as of" timestamp when a provider couldn't respond in time, as a deliberate availability-over-freshness trade-off for a view-only screen.

**Trade-off if probed.** Batching reduces call volume but couples the request shape to what each provider's batch API actually supports, and the cached-fallback approach is only acceptable because this is a valuation *display*, not the price used to execute a trade — worth stating that distinction unprompted, since it's the kind of nuance that separates "I added a cache" from "I understood where staleness is and isn't acceptable."

### 19.5 The seat-booking question: why it's a DB problem, not a JVM-locking problem

**The question, as usually asked.** "Two people book the same seat at the same moment — how do you make sure only one gets it?" A common trap is reaching straight for `synchronized`/`ReentrantLock`.

**Why JVM locking alone is the wrong answer.** A monitor or `Lock` only coordinates threads *within one JVM*. The seat's true state lives in the database and is shared across however many app instances are running. Two requests on two different instances would each take their own local lock, both see the seat as free, and both proceed — the lock would protect nothing. The real question is what guarantee the system of record (the DB) gives, not which Java construct to reach for.

**What's actually used in production, in order of preference:**
- **Unique constraint, let the DB reject the loser.** A `bookings` table with a unique constraint on `seat_id`. Both requests `INSERT`; the constraint itself is the mutual-exclusion point — one succeeds, the other fails and the app reports "already booked." No explicit locking in application code at all.
- **Optimistic concurrency (row-level compare-and-swap).** A `version`/`status` column on the seat row: `UPDATE seats SET status='booked', version=version+1 WHERE id=? AND version=? AND status='available'`. Zero rows affected means someone else won first — this is the DB-level analogue of the CPU/JVM CAS discussed in sections 2 and 5, and is usually preferred because it never holds a lock across a network round-trip.
- **Pessimistic locking (`SELECT ... FOR UPDATE`).** Locks the seat row for the duration of a transaction so a concurrent transaction blocks until the first commits. Correct, but only as cheap as the transaction is short — anything slow between the lock and the commit serializes requests through a DB-held lock.

**Where JVM-level locking can still help, in a minor way.** A per-seat local lock (e.g. a striped lock keyed by seat ID) can fast-fail two threads *on the same instance* before either makes a wasted DB round-trip. It's a latency optimization layered on top of the DB guarantee, never a substitute for it — remove it and correctness is unaffected.

**The nuance worth stating unprompted.** This is fundamentally a **write that needs idempotency/uniqueness**, not just mutual exclusion — the same distinction flagged in 19.3's money-movement note. A client retry after a timeout must not create a second booking, which the unique constraint/optimistic version solves for free, whereas a pure in-memory lock would not.

**The part the "instant booking" framing misses: a real UI flow has a gap, not a single moment.** A user doesn't book a seat in one request — they select seats, then spend real time (often minutes) on add-ons and payment before the booking is actually confirmed. The race isn't "two inserts at the same instant," it's "how do I keep a seat reserved for *this* user through that whole window without either (a) letting someone else take it mid-checkout, or (b) permanently losing the seat if the user abandons checkout." That reframes it as a two-phase problem:

- **Phase 1 — acquire a temporary hold.** Selecting a seat doesn't insert a confirmed booking; it creates a `status='held'` row (or flips the seat row to `held`) with an `expires_at` timestamp (TTL, typically 5–15 minutes), using the exact same optimistic `UPDATE ... WHERE status='available'` CAS from above. This is where the original race actually lives — two users selecting the same seat within milliseconds — and it's resolved the same way: one `UPDATE` affects a row, the other affects zero rows and that user is told the seat just became unavailable.
- **Phase 2 — convert the hold on payment success.** While held, no other request can acquire that seat (it's no longer `available`), so add-ons and payment proceed without contention. On successful payment, the hold is converted to `status='booked'` — again a conditional update guarded by holder identity (`WHERE status='held' AND held_by=?`), so only the session that holds the seat can confirm it.
- **Releasing abandoned holds.** If the user never completes payment, the hold must expire back to `available` — either a scheduled sweep (`UPDATE seats SET status='available' WHERE status='held' AND expires_at < now()`) or, more robustly, a lazy check: any read/update on a seat first checks `expires_at` and treats an expired hold as if it were available, so release doesn't depend on a background job running on time. Payment-gateway webhooks (success/failure/timeout) are the trigger to convert or release immediately rather than waiting for the TTL to lapse.

This two-phase hold is exactly the pattern behind "seats are held for 10 minutes" messages in real booking UIs — it's solving a liveness problem (don't starve other users behind an abandoned checkout) on top of the safety problem (no double-booking) the first part of this section covers.
