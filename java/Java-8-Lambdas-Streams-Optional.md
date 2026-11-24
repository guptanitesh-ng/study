# Java 8: Lambdas, Streams, Optional and Date/Time

This guide collects the Java 8 functional-programming material that used to live inside the core interview notes (default/static interface method recap, lambdas, method references, streams, `reduce()`, `Optional`) plus the Java 8 Date/Time API, consolidated with a supplied Java 8 study document. The core notes keep a pointer here; use this guide for the full explanations and examples.

## Contents

1. Default and static interface methods: the Java 8 entry point
2. Functional interfaces and lambda expressions
3. Checked exceptions inside lambdas
4. Method references
5. Streams: a processing style, not automatic parallelism
6. `map` versus `flatMap`
7. `reduce()`: three flavors
8. `Optional` models absence, not every failure
9. The Java 8 Date and Time API

## 1. Default and static interface methods: the Java 8 entry point

The full treatment — the diamond-style conflict between two default methods, resolving it with `Interface.super.method()`, precedence rules against a concrete superclass method, and Java 9's private interface helpers — lives in [Core Java](Java-Core-Notes.md#1-interfaces-from-contracts-to-shared-behavior), section 1. The short version worth repeating here:

- A `default` method gives an interface a body so existing implementers do not break when a new operation is added.
- A `static` interface method is a namespaced utility (`Notifier.isBlank(...)`); it is not inherited as an instance method by implementing classes.
- A default method **cannot override** `Object`'s public methods (`equals`, `hashCode`, `toString`). Those always resolve to the class hierarchy's own definition or `Object`'s, never to an interface default, because every class already inherits a concrete `Object` implementation and a concrete method wins over a default.

**Evolution example:** Java 8 added `List.sort` as a default, so existing list implementations inherited a general sorting implementation without each implementing the new method. `ArrayList` overrides it with an implementation suited to its backing array. The interface supplies compatibility and common behavior; specialized implementations can still optimize while respecting the same contract.

## 2. Functional interfaces and lambda expressions

### Foundation: a lambda supplies one interface operation

A functional interface has exactly one abstract method once Object-method and inheritance rules are applied; default/static methods do not add abstract operations. `@FunctionalInterface` asks the compiler to enforce that shape, but the annotation itself is optional — any interface meeting the shape works as a lambda target.

```java
@FunctionalInterface
interface TextRule {
    boolean accepts(String text);
}

class LambdaRecall {
    static void show() {
        TextRule anonymous = new TextRule() {
            @Override
            public boolean accepts(String text) {
                return text.length() >= 3;
            }
        };
        TextRule lambda = text -> text.length() >= 3;
        TextRule methodReference = LambdaRecall::longEnough;
        System.out.println(anonymous.accepts("java")); // true
        System.out.println(lambda.accepts("java")); // true
        System.out.println(methodReference.accepts("java")); // true
    }

    static boolean longEnough(String text) {
        return text.length() >= 3;
    }
}
```

The compiler knows `text` is `String` and the expression must return `boolean` because of `TextRule.accepts`. `text -> expression` uses an implicit return; `(text) -> { return expression; }` is the block form. `LambdaRecall::longEnough` refers to compatible behavior; it does not call the method when the reference is created.

An anonymous class creates its own `this`; a lambda uses the enclosing `this`. Captured locals must remain final/effectively final. A lambda cannot implement an arbitrary multi-operation interface or replace a superclass constructor/state model.

### Common built-in functional interfaces

| Interface | Abstract method | Typical use |
| --- | --- | --- |
| `Function<T, R>` | `R apply(T t)` | Transform a value |
| `Predicate<T>` | `boolean test(T t)` | A boolean condition |
| `Consumer<T>` | `void accept(T t)` | A side-effecting action, no return value |
| `Supplier<T>` | `T get()` | Lazily produce a value |
| `BiFunction<T, U, R>` | `R apply(T t, U u)` | Combine two inputs into one result |
| `UnaryOperator<T>` | `T apply(T t)` | `Function<T, T>` specialization |
| `BinaryOperator<T>` | `T apply(T t1, T t2)` | `BiFunction<T, T, T>` specialization, used by `reduce` |

### Beyond standalone use: composition and pipeline glue

Writing one inline lambda and processing it is the common case in real code. The less-visible role these interfaces play is as **composable units** and as the **typed plumbing between pipeline stages**:

- **Default-method composition.** `Predicate` offers `and`/`or`/`negate`; `Function`/`UnaryOperator` offer `andThen`/`compose`; `Comparator` offers `thenComparing`/`reversed`. Building small named predicates once and combining them is closer to a reusable specification than a throwaway lambda:

  ```java
  Predicate<Order> isHighValue = o -> o.getAmount() > 10_000;
  Predicate<Order> isInternational = o -> !o.getCountry().equals("IN");
  Predicate<Order> needsReview = isHighValue.and(isInternational).or(Order::isFlagged);

  orders.stream().filter(needsReview).forEach(reviewQueue::add);
  ```

- **Streams stages are typed slots for these interfaces, not special syntax.** `map` takes a `Function`, `filter` a `Predicate`, `forEach` a `Consumer`, `reduce` a `BinaryOperator`, `sorted` a `Comparator`, `flatMap` a `Function<T, Stream<R>>`. `Collectors.groupingBy(classifier, downstream)` goes one level further: `classifier` is a `Function`, and `downstream` is itself a `Collector` — which is internally assembled from a `Supplier`, a `BiConsumer`, a `BinaryOperator`, and optionally a `Function` (see `Collector.of`). Collectors are functional interfaces composed into a reusable mutable-reduction recipe, which is the closest Streams gets to treating them as infrastructure rather than inline code.
- **`Optional` chains the same combinators as Streams**, just at cardinality 0/1: `map`/`filter`/`orElseGet` use `Function`/`Predicate`/`Supplier` identically to their Stream counterparts (see section 8).
- **`CompletableFuture` repurposes them as async continuations** rather than data transforms: `thenApply(Function)`, `thenAccept(Consumer)`, `thenCompose(Function<T, CompletableFuture<R>>)`, `exceptionally(Function<Throwable, T>)`.
- **Method references pay off most once you compose**, since a composed pipeline reads as a sequence of named operations rather than nested lambda bodies: `Function<String, Integer> parseAndDouble = ((Function<String, Integer>) Integer::parseInt).andThen(x -> x * 2);`.

**Execute-around follow-up:** a callback can centralize a required acquire/release protocol while allowing callers to supply the work:

```java
static void withLock(java.util.concurrent.locks.Lock lock, Runnable work) {
    lock.lock();
    try {
        work.run();
    } finally {
        lock.unlock();
    }
}
```

The `finally` releases the lock even if `work` throws, and the exception still propagates. The work executes while holding the lock: keep it short, avoid blocking I/O, and remember that a reentrant lock must be released by its owning thread. Don't return an asynchronous task and assume its later work is protected.

## 3. Checked exceptions inside lambdas

None of the standard functional interfaces (`Function`, `Consumer`, `Supplier`, `Runnable`, and so on) declare a checked exception on their abstract method. A lambda body implementing one of them therefore cannot let a checked exception escape undeclared — the compiler rejects it the same way it would reject an overriding method widening a `throws` clause.

```java
import java.util.List;
import java.util.function.Function;

class LambdaChecked {
    static void broken(List<String> paths) {
        // Does not compile: IOException is checked and Function.apply
        // declares no checked exception.
        // Function<String, byte[]> reader = path -> java.nio.file.Files.readAllBytes(
        //         java.nio.file.Path.of(path));
    }

    static void wrapped(List<String> paths) {
        Function<String, byte[]> reader = path -> {
            try {
                return java.nio.file.Files.readAllBytes(java.nio.file.Path.of(path));
            } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        };
        paths.forEach(path -> System.out.println(reader.apply(path).length));
    }
}
```

Two usual fixes: catch the checked exception inside the lambda and rethrow an unchecked wrapper (`UncheckedIOException`, a custom `RuntimeException`), or declare a custom functional interface whose abstract method itself `throws` the checked type and only use it where the caller is prepared to handle that checked exception. Swallowing the exception silently is rarely the right third option.

## 4. Method references

A method reference is shorthand for a lambda that only forwards its arguments to an existing method; it does not call the method at reference-creation time, only when the functional interface's abstract method is invoked.

| Kind | Syntax | Equivalent lambda | Example |
| --- | --- | --- | --- |
| Static method | `Type::staticMethod` | `args -> Type.staticMethod(args)` | `Integer::parseInt` |
| Bound instance method | `instance::method` | `args -> instance.method(args)` | `someList::add` |
| Unbound instance method | `Type::instanceMethod` | `(obj, args) -> obj.instanceMethod(args)` | `String::strip` |
| Constructor | `Type::new` | `args -> new Type(args)` | `ArrayList::new` |

```java
import java.util.List;
import java.util.function.Supplier;

class MethodReferenceDemo {
    static List<String> normalize(List<String> names) {
        Supplier<List<String>> factory = java.util.ArrayList::new; // constructor reference
        List<String> result = factory.get();
        names.stream()
                .map(String::strip)      // unbound instance method
                .forEach(result::add);    // bound instance method
        return result;
    }
}
```

`String::strip` works as an unbound reference here because the stream supplies the receiver (`name.strip()`); `result::add` is bound because `result` already exists as a concrete object. The target functional interface's signature — not the reference's spelling — decides which form applies.

## 5. Streams: a processing style, not automatic parallelism

### Internal iteration and laziness

A stream describes *what* to compute; the terminal operation decides *when and how* the pipeline runs (internal iteration), as opposed to a `for`/`Iterator` loop where the caller drives each step (external iteration). Intermediate operations (`filter`, `map`, `sorted`, `distinct`) are lazy: writing them builds a pipeline description without touching a single element. Nothing executes until a terminal operation (`forEach`, `collect`, `reduce`, `findFirst`, `count`, ...) is invoked, and elements are then usually pulled through the whole pipeline one at a time rather than one stage finishing fully before the next starts.

```java
import java.util.List;

class NamePipeline {
    static List<String> normalize(List<String> names) {
        return names.stream()
                .filter(name -> name != null)
                .map(String::strip)
                .filter(name -> !name.isEmpty())
                .distinct()
                .toList();
    }
}
```

This accepts null elements intentionally, strips names, drops blanks, retains distinct values in encounter order and returns an unmodifiable list. `strip` requires Java 11 and `Stream.toList` Java 16. In Java 8, use suitable trimming methods and `Collectors.toList()` instead; `Collectors.toList()` itself promises no specific implementation or mutability.

### Pipeline reasoning for interviews

| Operation/concept | Meaning | Common mistake |
| --- | --- | --- |
| `map` | One result per input | Returning streams and accidentally producing a stream of streams |
| `flatMap` | Flatten zero/many results per input | Losing track of ownership/closing of I/O-backed sources |
| Lazy intermediate operations | Work is driven by a terminal operation | Expecting a pipeline declaration to execute side effects |
| Short-circuiting | Operations such as `findFirst`/`anyMatch` can stop early | Expecting every element's callback to run |
| Single use | A stream cannot be consumed twice | Caching a stream instead of a reusable collection or supplier |
| Reduction | Combine values using appropriate associative operations | Using subtraction or shared mutable state in parallel reduction |

Do not use `peek` or other pipeline side effects for mandatory auditing: execution can be skipped or optimized, and short-circuiting changes which elements are processed. Use explicit reliable workflow steps for required side effects.

### Parallel versus sequential: what actually decides performance

`stream()` runs sequentially on the calling thread; `parallelStream()` (or `.stream().parallel()`) splits work across the common `ForkJoinPool`. Parallel is not automatically faster. What tends to matter in practice:

- **Data size and per-element cost.** Splitting and merging has overhead; a small collection or a cheap per-element operation can lose to sequential execution.
- **Source splittability.** An `ArrayList`/array splits cheaply and evenly; a `LinkedList` or an I/O-backed source splits poorly or not at all.
- **Statelessness and lack of ordering dependence.** Operations should not depend on encounter order or mutate shared state; `forEachOrdered` and unnecessary `sorted` reintroduce ordering costs that fight parallelism.
- **Common-pool contention.** Every unconfigured parallel stream in the JVM shares the same `ForkJoinPool.commonPool()`. Blocking I/O or another concurrent parallel stream running at the same time can starve both.
- **Measurement over intuition.** Benchmark the actual workload; "it is parallel" is not evidence it is faster.

**Parallel stream scenario:** a shared `ArrayList` is mutated in `parallelStream().forEach`. This is a data race, not a faster collector. Prefer appropriate collectors/reduction, and measure.

**Interview follow-up: "Why did parallelizing my ordered report make it slower?"** `distinct`, `sorted`, `skip` and `limit` are stateful: they can require buffering or coordination across partitions. On an ordered source, preserving the *first* matching values or the *first* distinct occurrence constrains what workers may return. `unordered()` removes the encounter-order requirement where it exists; it does not shuffle elements or guarantee a speedup, and changes the allowed result for operations such as `limit`. Only use it when *any* qualifying subset is acceptable.

| Choice | What the caller can rely on | Trade-off |
| --- | --- | --- |
| `findFirst()` | First in encounter order when one exists | Preserving order can constrain parallel work |
| `findAny()` | Any matching element; empty if none | Gives the implementation more freedom; it can still return the first |
| `forEach()` | Each selected element is processed without encounter-order guarantees | Side effects may run concurrently; shared state needs protection |
| `forEachOrdered()` | Actions follow encounter order if the stream has one | Coordination can limit parallel speedup; it does not impose an order on an unordered source |

For numeric processing, `mapToInt`/`IntStream` can avoid boxing intermediate `Integer` values and provides `sum`, `average` and related operations. An `int` sum can still overflow; select an appropriate numeric type and measure with the real input, allocation rate and workload rather than assuming primitive streams or parallelism always win.

**Deferred reading:** collection-specific stream integration (`Collectors`, grouping, partitioning) belongs with the separate collections study rather than this Java 8 language-feature guide.

## 6. `map` versus `flatMap`

`map` produces exactly one output per input element — including when that output is itself a stream, which is the classic mistake: `map(this::linesOf)` over a list of files produces a `Stream<Stream<String>>`, not a flat `Stream<String>`. `flatMap` produces zero, one, or many output elements per input by supplying a stream per element and flattening the results into one stream.

```java
import java.util.List;
import java.util.stream.Stream;

class FlattenLines {
    static Stream<String> allLines(List<List<String>> documents) {
        return documents.stream()
                .flatMap(List::stream); // one inner stream per document, flattened
    }
}
```

`flatMap` closes each mapped inner stream after consuming it, including an inner `Files.lines(path)` stream. If the **outer** stream itself owns a resource, close that outer stream with try-with-resources; terminal operations do not automatically close it. Do not close an inner stream inside the mapper before returning it, since `flatMap` still needs to consume it.

## 7. `reduce()`: three flavors

`Stream.reduce` combines elements using an associative operation. Three overloads exist, trading identity/combiner arguments for flexibility:

```java
import java.util.List;
import java.util.Optional;

class ReduceFlavors {
    static int sumWithIdentity(List<Integer> values) {
        // (T identity, BinaryOperator<T> accumulator) -> T
        return values.stream().reduce(0, Integer::sum);
    }

    static Optional<Integer> sumWithoutIdentity(List<Integer> values) {
        // (BinaryOperator<T> accumulator) -> Optional<T>
        return values.stream().reduce(Integer::sum);
    }

    static int totalLength(List<String> values) {
        // (U identity, BiFunction<U,T,U> accumulator, BinaryOperator<U> combiner) -> U
        return values.stream().reduce(
                0,
                (runningTotal, text) -> runningTotal + text.length(),
                Integer::sum);
    }
}
```

- **Identity + accumulator** returns `T` directly; the identity is the result for an empty stream and must be a true identity value for the accumulator (`0` for `+`, `1` for `*`, not an arbitrary default).
- **Accumulator only** returns `Optional<T>` because an empty stream has no element to fall back on.
- **Identity + accumulator + combiner** supports changing the element type mid-reduction (accumulating `U` from `T` elements); the combiner is only invoked by a parallel stream to merge partial results and must be compatible with the accumulator's associativity, or a parallel run can produce a different answer than a sequential one.

Prefer `Integer::sum`/`Double::sum` style method references over `(a, b) -> a - b` or other non-associative/non-commutative operations in `reduce`; subtraction-style reductions give order-dependent results that silently break under parallel execution.

**Max/min identity trap:** `Stream.of(-8, -3).reduce(0, Integer::max)` returns `0`, which was not an input. Use `reduce(Integer::max)` or `max(Integer::compare)` and handle the empty `Optional`; alternatively use `Integer.MIN_VALUE` as a true identity for `max` only when that empty-stream result is appropriate. For `min`, the corresponding bound is `Integer.MAX_VALUE`; `0` is wrong for an all-positive input.

## 8. `Optional` models absence, not every failure

Java 8 introduced `Optional` as a useful return type for an absent result. It should not itself be null. It does not explain why a network call failed or replace a proper error model.

```java
import java.util.Optional;

class OptionalChaining {
    record Address(String city) { }
    record Customer(Optional<Address> address) { }

    static String cityOrDefault(Customer customer) {
        return customer.address()
                .map(Address::city)
                .filter(city -> !city.isBlank())
                .orElse("unknown");
    }

    static Optional<Address> firstAddressWithCity(List<Customer> customers) {
        return customers.stream()
                .flatMap(customer -> customer.address().stream()) // Optional.stream(), Java 9
                .findFirst();
    }
}
```

`map` transforms the contained value when present and is a no-op otherwise; `flatMap` is needed when the mapping function itself returns an `Optional`, to avoid `Optional<Optional<T>>`. `orElse(expensiveFallback())` evaluates its argument eagerly even when a value exists; `orElseGet(() -> expensiveFallback())` supplies the fallback lazily. Prefer `map`, `flatMap`, `ifPresent`, or an explicit absence decision over unchecked `get()`. Primitive optional types (`OptionalInt`, `OptionalLong`, `OptionalDouble`) avoid some boxing.

`Optional` deliberately does not implement `Serializable`. It is meant as a method return type, not a field type to persist or transmit; an entity field or DTO member holding an `Optional` and serialized or written through a framework that relies on standard Java serialization is misusing the type. Collections usually represent "no items" with an empty collection rather than `Optional<List<T>>`.

**Interview follow-up:** "Should every entity field or parameter be `Optional`?" No. Match the surrounding API/framework and serialization contracts; a return-value pattern is not automatically a good persistence-field design.

## 9. The Java 8 Date and Time API

### Choosing the right type

| Requirement | Suitable type | Trap to avoid |
| --- | --- | --- |
| An event on the global timeline | `Instant` | Using the server's local wall-clock time as a global timestamp |
| A calendar date, such as a birthday | `LocalDate` | Adding a meaningless UTC midnight and shifting dates across zones |
| A local appointment plus regional rules | `ZonedDateTime` or explicit local time and `ZoneId` policy | Daylight-saving gaps/overlaps can need explicit resolution |
| A timestamp with a fixed offset | `OffsetDateTime` | An offset is not a region's full future DST rule set |
| A wall-clock time without a date | `LocalTime` | Using it where an actual instant or zone-aware value is needed |
| Combined local date and time | `LocalDateTime` | Treating it as a global instant; it has no time zone |
| Time-based versus date-based amount | `Duration` versus `Period` | A calendar day across a DST change need not be exactly 24 elapsed hours |

`java.time` and `DateTimeFormatter` arrived in Java 8 and are designed around immutable types. Legacy `SimpleDateFormat`/`Date`/`Calendar` are mutable and not thread-safe. Prefer injecting a `Clock` into time-dependent code so tests do not depend on the real wall clock.

### Measuring and adjusting: `Period`, `Duration`, `ChronoUnit`, `TemporalAdjuster`

```java
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Period;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;

class DateTimeDemo {
    static void show() {
        LocalDate start = LocalDate.of(2024, 1, 15);
        LocalDate end = LocalDate.of(2024, 3, 1);

        Period calendarGap = Period.between(start, end);      // years/months/days
        long daysBetween = ChronoUnit.DAYS.between(start, end); // a single total unit

        LocalDateTime meetingStart = LocalDateTime.of(2024, 1, 15, 9, 0);
        Duration meetingLength = Duration.ofMinutes(45);
        LocalDateTime meetingEnd = meetingStart.plus(meetingLength);

        LocalDate nextMonthEnd = start.with(TemporalAdjusters.lastDayOfMonth());
        LocalDate firstMondayOfMonth = start.with(
                TemporalAdjusters.firstInMonth(java.time.DayOfWeek.MONDAY));

        System.out.println(calendarGap); // P1M14D-style breakdown
        System.out.println(daysBetween); // a plain count of days
        System.out.println(meetingEnd);
        System.out.println(nextMonthEnd);
        System.out.println(firstMondayOfMonth);
    }
}
```

- `Period` expresses a date-based amount in years/months/days ("1 month and 14 days"); `Duration` expresses a time-based amount in seconds/nanoseconds ("45 minutes"). Use `Period` with date types and `Duration` with time/instant types; mixing them (such as adding a `Duration` of "1 day" across a DST transition) does not account for calendar irregularities the way `Period` does.
- `ChronoUnit.DAYS.between(...)` (and `HOURS`, `MINUTES`, and so on) gives a single total count in one unit, which is often simpler than decomposing a `Period`/`Duration` when only one number is needed.
- A `TemporalAdjuster` (via `TemporalAdjusters` factory methods, or a custom lambda implementing the functional interface) computes a derived date such as "last day of month" or "first Monday of month" without manual calendar arithmetic.
