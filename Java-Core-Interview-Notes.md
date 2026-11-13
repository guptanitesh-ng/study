# Core Java: Practical Interview Notes through Java 21

**Companion guides:** [Exceptions, Generics, I/O and Serialization](Java-Exceptions-Generics-IO-Serialization.md) contains the detailed material moved from sections 9, 13, 15 and 16, plus an expanded generics guide incorporating the supplied PDF. [Java 8: Lambdas, Streams, Optional and Date/Time](Java-8-Lambdas-Streams-Optional.md) contains the detailed material moved from section 14 and the Java 8 date/time subsection of section 11, consolidated with a second supplied PDF. Those section numbers remain as pointers here. Collections and multithreading are still deferred to their own guides.

## 1. Interfaces: from contracts to shared behavior

### What changed from Java 5–7?

The original notes say interface methods are implicitly public and abstract, cannot be static, and cannot have implementations. That describes ordinary interface methods in **Java 5–7**, not every interface method in modern Java.

| Version | Rule at that point | Why remember it? |
| --- | --- | --- |
| Java 5–7 | Declared interface methods are public and abstract; implementing classes supply the behavior | The original contract-only mental model |
| Java 8 | Interfaces can declare `default` instance methods and `static` methods with bodies | Evolve contracts with inherited behavior and provide interface-level utilities |
| Java 9 | Interfaces can also declare private instance and private static methods with bodies | Share implementation details without exposing helper methods as public API |
| Java 17 | Sealed interfaces became a standard feature after previews in Java 15/16 | Restrict direct implementations/subinterfaces when modelling a controlled hierarchy |
| Through Java 21 | These capabilities remain; interfaces still have no per-instance fields or constructors | Shared behavior does not turn an interface into a stateful base class |

- All variables defined in an interface are by default public, static, and final in other words, interfaces can declare only constants, not instance variables.
- Because interface methods are abstract, they cannot be marked final, strictfp, or native.
- An interface can *extend* one or more other interfaces.
- An interface cannot extend anything but another interface.
- An interface cannot implement another interface or class.
- The public modifier is required if you want the interface to have public rather than default access

### Practical example: adding behavior without rewriting every implementation

Suppose several notification implementations already implement `send`. A Java 8 interface can provide an additional convenience operation:

```java
public interface Notifier {
    void send(String message);

    default void sendAll(Iterable<String> messages) {
        for (String message : messages) {
            send(message);
        }
    }

    static boolean isBlank(String message) {
        return message == null || message.trim().isEmpty();
    }
}
```

An existing `EmailNotifier` that supplies a public `send` implementation can inherit `sendAll`. Calling `sendAll` dispatches each `send` call to that object's implementation. Call the static utility as `Notifier.isBlank(message)`; static interface methods are not inherited as instance methods by implementing classes.

**Why Java 8 introduced this:** adding a new abstract method to a widely implemented interface normally forces concrete implementations to supply it when recompiled. A default implementation can ease interface evolution. It is not a blanket compatibility guarantee: existing method conflicts and behavior still need review.

**Follow-up: "Can I override `sendAll`?"** Yes. A default method is an overridable instance method, not a final utility. Implementations should preserve the contract when replacing it.

### Java 9: keep shared helpers private

Before Java 9, an interface could not declare a private helper method. From Java 9, default/static implementations can share private helpers:

```java
public interface NamedNotifier {
    void send(String message);

    default void sendAlert(String message) {
        send(format("ALERT", message));
    }

    default void sendReminder(String message) {
        send(format("REMINDER", message));
    }

    private String format(String category, String message) {
        return "[" + category + "] " + message;
    }
}
```

`format` belongs to the interface's implementation details. An implementing class cannot call or override it. A private instance helper can be called from instance behavior; a static method needs a static helper if it wants to use one.

### What if two interfaces provide the same default method?

**Scenario:** a class implements unrelated `Auditable` and `Traceable` interfaces, both declaring `default String label()`. Java does not arbitrarily choose one; the implementing class must resolve the conflict.

```java
public class Operation implements Auditable, Traceable {
    @Override
    public String label() {
        return Auditable.super.label();
    }
}
```

Assume both interfaces are direct superinterfaces with that default method. This implementation deliberately selects one; it could instead combine their behavior or supply its own.

**Rules to explain in an interview:** a concrete superclass method takes precedence over an interface default; a more-specific subinterface default takes precedence over its ancestor's default; unrelated competing defaults need explicit resolution. An abstract superclass declaration can still require the subclass to implement the method rather than relying on a default.

This is multiple inheritance of **type and some behavior**, not multiple inheritance of class instance state.

### Interface or abstract class?

| Requirement | Usual starting point |
| --- | --- |
| Unrelated classes need the same capability/contract | Interface; a class can implement multiple interfaces |
| Shared convenience behavior using the public contract | Consider a default method |
| Shared instance fields, constructor-enforced state, or protected implementation hooks | Consider an abstract class; a class extends only one class |
| A deliberately restricted family of implementations | Consider a sealed interface/class |

Do not move domain state into interface fields to simulate inheritance: interface fields are implicitly `public static final`. A final reference can still point to a mutable object, so such a field is not automatically an immutable constant.

### Java 17 sealed interfaces, used with Java 21 pattern matching

This example combines **three separate features**: sealed interfaces, records and pattern matching. If you know Java 8, learn them in that order rather than trying to decode all the new syntax at once.

#### Step 1: start with the Java 8 relationship you already know

```java
public interface PaymentResult { }

public final class Paid implements PaymentResult {
    // Payment reference and other details
}

public final class Declined implements PaymentResult {
    // Decline reason and other details
}
```

These are separate public types in separate files. The empty interface groups the result types; an interface does not have to declare methods to express a type relationship.

In Java 8, nothing in that interface prevents someone from adding `Pending implements PaymentResult`. Making `Paid` final stops someone extending **Paid**, not someone creating another implementation of **PaymentResult**.

#### Step 2: Java 17 lets the parent restrict its direct subtypes

```java
public sealed interface PaymentResult permits Paid, Declined { }
```

Read this aloud as: **"PaymentResult is a public interface, and only Paid and Declined may directly implement it."**

| Declaration part | Meaning |
| --- | --- |
| `public` | The familiar access modifier |
| `sealed` | Restrict the type's direct subtypes |
| `interface PaymentResult` | The ordinary interface declaration |
| `permits Paid, Declined` | Name the allowed direct subtypes |
| `{ }` | Empty body; no common methods are needed here |

**`permits` does not replace `implements`.** The parent declares who is allowed, and the children still declare their relationship:

```java
public sealed interface PaymentResult permits Paid, Declined { }

public final class Paid implements PaymentResult { }
public final class Declined implements PaymentResult { }
```

Now a new `Pending implements PaymentResult` fails to compile unless the parent permits it. This is a Java type-system restriction, not a runtime permissions check.

A permitted implementing class must declare how further inheritance works: `final` closes that branch, `sealed` restricts its next subtypes, and `non-sealed` reopens it to unrestricted extension. Here both implementations are final, so the family is closed to those two concrete types. A permitted subinterface must instead be sealed or non-sealed; interfaces cannot be final.

For these examples, keep the separate files in the same package. More precisely, permitted direct subtypes must be in the same named module, or in the same package when using the unnamed module. These placement rules are not a requirement to put every declaration in one source file.

#### Step 3: records shorten the data classes; they are not required for sealing

Instead of manually writing the data-carrier classes, the example uses records:

```java
public sealed interface PaymentResult permits Paid, Declined { }
public record Paid(String reference) implements PaymentResult { }
public record Declined(String reason) implements PaymentResult { }
```

Records became standard in **Java 16** and are implicitly final, so they satisfy the sealed hierarchy's subtype restriction. Read `record Paid(String reference)` as **"a final data-carrier class with a String component called reference."** The parentheses declare its data components, not interface method parameters.

Its rough Java 8 equivalent is:

```java
public final class Paid implements PaymentResult {
    private final String reference;

    public Paid(String reference) {
        this.reference = reference;
    }

    public String reference() {
        return reference;
    }

    // A record also generates component-based equals, hashCode and toString.
}
```

Notice the accessor is `reference()`, not `getReference()`. A record containing mutable components is not automatically deeply immutable; section 8 develops that distinction.

`PaymentResult result = new Paid("PAY-123");` is still the familiar **interface reference pointing to an implementation object**. You could use ordinary final classes instead: **sealed does not require records**.

**Practical use:** success carries a payment reference; decline carries a reason. This avoids a boolean plus loosely related nullable fields whose valid combinations callers have to guess.

#### Step 4: compare Java 8 type checks with Java 21 pattern matching

With the ordinary data classes, Java 8 handling could look like this:

```java
static String describe(PaymentResult result) {
    if (result instanceof Paid) {
        Paid paid = (Paid) result;
        return "Paid: " + paid.reference();
    }
    if (result instanceof Declined) {
        Declined declined = (Declined) result;
        return "Declined: " + declined.reason();
    }
    throw new IllegalArgumentException("Unknown payment result");
}
```

This Java 8 example rejects null through its final exception path. The equivalent business decision still needs to be explicit in modern code.

Java 21's standard pattern matching for `switch` combines the type check and cast:

```java
static String describe(PaymentResult result) {
    return switch (result) {
        case Paid paid -> "Paid: " + paid.reference();
        case Declined declined -> "Declined: " + declined.reason();
    };
}
```

Read `case Paid paid ->` as **"if result is a Paid, bind it to a variable named paid, then evaluate this branch."** `Paid` is the type; lowercase `paid` is the new local variable. `paid.reference()` calls that object's accessor. `return switch` returns the value produced by the selected branch; this is not the old colon-style fall-through switch.

The compiler knows the complete alternatives from the sealed hierarchy. Because both final implementations are handled, this switch is **exhaustive** without a `default`. If you later permit a third implementation and recompile this method, the compiler flags the missing handling.

A null input still throws `NullPointerException` in this version unless explicitly handled, for example with `case null`. That differs from the Java 8 example's explicit final rejection; choose the null contract intentionally rather than assuming a syntax rewrite preserves it.

#### Quick recall without rewriting the whole example

| Feature | One-sentence memory cue |
| --- | --- |
| Ordinary interface | "Implement my contract." |
| Sealed interface, Java 17 | "Only these types may directly implement/extend me." |
| Record, Java 16 | "Generate a concise data carrier, including constructor, accessors and value methods." |
| Pattern switch, Java 21 | "Check the alternative's type, give it a typed variable and handle its data." |

**Interviewer: "Why not an enum?"** An enum models a fixed set of named instances, such as `APPROVED` and `DECLINED`. Here there can be many `Paid` objects with different references and many `Declined` objects with different reasons. The sealed hierarchy fixes the **kinds of result**, not the individual result instances.

#### Enum versus record: side-by-side distinction

The difference is not just generated boilerplate. **An enum defines the named instances; a record defines a data shape from which callers create instances.** Both can have fields and methods.

| Question | Enum | Record |
| --- | --- | --- |
| What does it define? | A fixed set of named instances | A data shape whose instances callers create |
| Where does instance data come from? | Constant declarations supply constructor arguments when the constants are initialized | Callers supply constructor arguments at runtime for each new value |
| Can it have methods? | Yes, including constant-specific behavior | Yes, including validation and derived behavior |
| What does equality mean? | Same enum constant; `==` is appropriate | Equal component values; use `equals` |
| Can it implement interfaces? | Yes | Yes |
| Is it automatically deeply immutable? | No; even its fields need not be final | No; component fields are final, but referenced objects can be mutable |

**Recall snippet: where does the data come from?** Compare a predefined status description with a reference belonging to one particular payment:

```java
enum PaymentStatus {
    APPROVED("Payment accepted"),
    DECLINED("Payment rejected");

    private final String description;

    PaymentStatus(String description) {
        this.description = description;
    }

    public String description() {
        return description;
    }
}

record PaymentReceipt(String reference) { }

class EnumRecordRecall {
    static void compare() {
        PaymentStatus firstStatus = PaymentStatus.APPROVED;
        PaymentStatus secondStatus = PaymentStatus.APPROVED;
        // Same predefined object; description came from APPROVED's declaration.
        System.out.println(firstStatus == secondStatus); // true
        System.out.println(firstStatus.description()); // Payment accepted

        PaymentReceipt first = new PaymentReceipt("PAY-123");
        PaymentReceipt second = new PaymentReceipt("PAY-456");
        PaymentReceipt again = new PaymentReceipt("PAY-123");
        // Separate objects; references came from these constructor calls.
        System.out.println(first.reference()); // PAY-123
        System.out.println(second.reference()); // PAY-456
        System.out.println(first == again); // false
        System.out.println(first.equals(again)); // true
    }
}
```

The enum part works in Java 8; the record requires Java 16 or later. You cannot call `new PaymentStatus(...)` to create a status for each payment. You can create as many `PaymentReceipt` values as needed with caller-supplied data.

**Do not store per-payment state on an enum constant:** a mutable `currentPaymentReference` field on `APPROVED` would be shared by unrelated payments using that constant. Enums remain useful for fixed policies with methods that accept varying inputs; the policy instance is predefined, while the inputs/results vary.

**Memory hook:** enum = **"which predefined option or policy?"**; record = **"what data describes this particular value?"**; sealed hierarchy = **"which permitted shape of value is this?"**

**Interviewer: "Would you seal every interface?"** No. It fits an application-owned closed family where callers should handle known alternatives. An extension contract intended for third-party implementations should usually remain open.

**Interview recall:** "In Java 5–7, interface methods were abstract contracts. Java 8 added default/static implementations, Java 9 added private helpers, and Java 17 added standard sealed hierarchies. By Java 21 I can combine these with records and pattern-switch handling, while interfaces still have no instance state."

## 2. Abstract classes: shared state, controlled workflow and inheritance trade-offs

### What stayed the same, and what changed?

The original notes correctly say an abstract method cannot also be `private`, `static` or `final`. An abstract instance method leaves implementation to a subclass; those modifiers would prevent the required overriding. **This rule did not change through Java 21.**

| Version | Rule at that point | Practical implication |
| --- | --- | --- |
| Java 5–7 | Abstract classes can have constructors, instance fields, concrete methods and abstract methods | Share state and implementation while leaving selected operations to subclasses |
| Java 8 | Interface default methods became available; abstract-class rules did not change | Shared behavior alone no longer automatically calls for an abstract class |
| Java 9 | Private interface helpers became available | Private helper reuse alone is not a reason to introduce a base class either |
| Java 17 | Sealed classes became standard | An abstract base class can restrict its direct subclasses rather than allowing unrestricted extension |
| Through Java 21 | A class still extends only one class; abstract classes still cannot be instantiated directly | Choosing a base class consumes the subclass's single class-inheritance slot |

**Important distinction:** `abstract` means "not directly instantiable", not "contains only abstract methods". An abstract class may have no abstract methods at all. It can also contain private helpers, static utilities and final concrete methods; the incompatible modifiers above concern the **abstract method itself**.

### Scenario: several exporters share a workflow, but format data differently

Suppose CSV and JSON exporters must reject missing input and use the same configured maximum number of rows. Only the formatting step varies. A base class can own the configuration and protect the workflow:

```java
import java.util.List;
import java.util.Objects;

abstract class ReportExporter {
    private final int maxRows;

    protected ReportExporter(int maxRows) {
        if (maxRows <= 0) {
            throw new IllegalArgumentException("maxRows must be positive");
        }
        this.maxRows = maxRows;
    }

    public final String export(List<String> rows) {
        Objects.requireNonNull(rows, "rows");
        if (rows.size() > maxRows) {
            throw new IllegalArgumentException("Too many rows");
        }
        return format(rows);
    }

    protected abstract String format(List<String> rows);
}

final class LineReportExporter extends ReportExporter {
    LineReportExporter(int maxRows) {
        super(maxRows);
    }

    @Override
    protected String format(List<String> rows) {
        return String.join("\n", rows);
    }
}
```

Calling `new LineReportExporter(100).export(List.of("first", "second"))` runs the base-class checks, then dispatches `format` to `LineReportExporter`. `List.of` was introduced in **Java 9**; the inheritance design itself works in Java 5–7 with an older way of constructing the list.

This is the **Template Method** pattern: a concrete method defines the workflow and delegates selected steps to overridable hooks. `export` is final so a subclass cannot override that entry point and omit its checks. The protected hook is an extension point, not part of the public caller-facing API.

**Boundary:** this protects the inherited `export` workflow, not every operation a subclass could add. It is not a security sandbox, and the final `maxRows` field does not by itself make a future stateful exporter thread-safe.

### "If I cannot instantiate an abstract class, why does it have a constructor?"

Because creating a concrete subclass also initializes its superclass state. In the example:

```text
new LineReportExporter(100)
  -> ReportExporter(100) validates and initializes maxRows
  -> LineReportExporter constructor body completes
  -> caller receives one initialized LineReportExporter object
```

There are not two independent objects, one abstract and one concrete. The subclass instance includes the superclass's instance state. The private field is not directly accessible from the subclass, but the inherited base-class methods use it.

Constructors are **not inherited or overridden**. The subclass constructor explicitly invokes `super(maxRows)` because the base class has no no-argument constructor.

**Historical wording to refine:** through Java 21, an explicit `this(...)` or `super(...)` invocation must be the first **statement**, not necessarily the first textual line. If neither is written, the compiler normally inserts `super()`, which must resolve to an accessible no-argument superclass constructor. A `this(...)` chain must ultimately reach a superclass constructor; it cannot recurse indefinitely.

### Real failure mode: calling an overridable method from a constructor

A base-class constructor runs before the subclass's instance field initializers and constructor body. However, an overridable method call still dispatches to the subclass implementation:

```java
abstract class BaseJob {
    BaseJob() {
        printName();
    }

    protected abstract void printName();
}

final class CleanupJob extends BaseJob {
    private String name = "cleanup";

    @Override
    protected void printName() {
        System.out.println(name);
    }
}
```

`new CleanupJob()` prints **`null`**, not `"cleanup"`: `name` still has its default value when the base constructor calls the override. Calling `name.length()` there would throw `NullPointerException`.

**Practical response:** avoid invoking overridable behavior during construction. Initialize base state through constructor arguments and private/final helpers that do not dispatch into incompletely initialized subclass behavior. Run the extensible workflow only after construction. Java 21 did not remove this hazard.

### Java 17: abstract and sealed solve different problems

`abstract` prevents direct construction; `sealed` controls which classes may extend the base:

```java
abstract sealed class ExportOutcome permits ExportSuccess, ExportFailure { }

final class ExportSuccess extends ExportOutcome { }
final class ExportFailure extends ExportOutcome { }
```

For these top-level declarations, keep the classes in the same package when using the unnamed module; in a named module, permitted direct subclasses must be in that same module. Each permitted direct subclass must be `final`, `sealed` or `non-sealed`. A `non-sealed` branch deliberately reopens extension below that point.

**Do not seal everything:** an application-owned closed result hierarchy can benefit from sealing. A library base class explicitly designed for customer extensions usually needs an open extension model instead.

### Interview follow-ups: abstract class, default method or composition?

| Interviewer asks | Answer and decision |
| --- | --- |
| "Didn't Java 8 make abstract classes redundant?" | No. Default methods do not provide per-instance fields, constructors or protected hooks. Use a base class when those capabilities fit a genuine subtype relationship, not merely to avoid copying code. |
| "Can an abstract class implement an interface without implementing every method?" | Yes. It may leave methods unimplemented for subclasses. A concrete subclass must satisfy the remaining abstract contracts. |
| "Can a concrete subclass leave the protected hook unimplemented?" | Not unless it inherits a suitable concrete implementation. Otherwise it must implement the hook or also be abstract. |
| "Can I make the abstract method final to enforce the contract?" | No. Make the concrete workflow final and leave the variable step abstract, as in `export` and `format`. |
| "My class already extends another framework base class. How do I reuse this workflow?" | It cannot extend a second class. Put the workflow in a collaborator and delegate to it, possibly using an interface for the variable formatting step. |
| "When is composition a better fit?" | When behavior should be selected at runtime, reused across unrelated classes, or varied independently of the class hierarchy. A formatter passed into an exporter avoids a subclass for every combination of behavior. |

**Warning sign in a real codebase:** subclasses override many hooks just to undo base-class assumptions, or changes to the base repeatedly break unrelated subclasses. The inheritance relationship may be coupling independent responsibilities; prefer smaller contracts and delegated collaborators rather than adding more flags and hooks.

**Interview recall:** "Abstract classes already supported shared state, constructors and partial implementation in Java 5–7. Java 8/9 expanded what interfaces can do, so behavior reuse alone is not enough reason to choose inheritance. Java 17 added sealed extension control. Through Java 21, I still use a base class for a stable shared workflow and state, and composition when the behaviors need to vary independently."

## 3. Declarations, access control and modules

### Foundation: source files, names and the kind of declaration

Think of a source file as a compilation unit, not necessarily one class. Its optional package declaration and imports apply to the whole file. Imports make names convenient; they do not bypass access checks or import the contents of a subpackage.

In ordinary file-based compilation, `public class Invoice` belongs in `Invoice.java` . That file can also contain package-private helper types, but not a second public top-level type. 

Without a public top-level type, there is no corresponding public-type filename requirement. A package-private type is visible within its package, not automatically to subpackages.

Identifiers cannot start with a digit; after the first character, digits are allowed. Names are case-sensitive, so `count` and `Count` are different. Java accepts more Unicode identifier characters than ASCII letters, but keywords and the literals `true`, `false` and `null` cannot be used as identifiers. Identifiers must start with a letter, a currency character ($). The single `_` is no longer an identifier on Java 9+.

**First classify the declaration, then choose its modifiers:**

| Declaration | Access and relevant modifiers | Mental model |
| --- | --- | --- |
| Top-level class | `public` or package-private; may be abstract/final/sealed as appropriate | Visibility of the type itself |
| Member class | Can also be private/protected; may be static | A type grouped inside another type |
| Field | Access modifiers; possibly static/final/transient/volatile | State associated with an object or class |
| Ordinary method | Access modifiers; possibly static/final/abstract/synchronized/native | Behavior; an abstract method has no implementation body |
| Constructor | Access modifiers, but not static/final/abstract; may declare exceptions | Initialization of a new object, not an inherited method |
| Local variable / parameter | Can be final; no access modifier, static, transient or volatile | A value available within a particular scope |

These are not freely combinable checkboxes. `abstract final` is contradictory for a class or method; `abstract private` and `abstract static` cannot define an overridable abstract method. `native` delegates implementation outside Java rather than supplying a Java body. `strictfp` historically controlled floating-point evaluation on types/methods, not variables; its modern status is explained below.

### Earlier rule and modern additions

In the ordinary file-based compilation model, a public top-level class belongs in a matching `.java` file. A file may also contain package-private top-level types. Top-level types cannot be `private` or `protected`; **member** types can. "Default access" means package-private access, not an actual `default` access modifier.

| Version | Change | What it does not mean |
| --- | --- | --- |
| Java 5 | `enum` became a keyword; annotations and generics entered the language | Every old identifier remains valid forever |
| Java 9 | `_` alone became a keyword; the module system added readability and export boundaries | A public class is automatically accessible across every module |
| Java 10 | `var` added local-variable type inference | Java became dynamically typed, or fields/return types can use `var` |
| Java 11 | Lambda parameters can use `var`, consistently within their parameter list | A parameter can mix `var` with explicit types or untyped parameters |
| Java 17 | Floating-point expressions became always-strict again | Adding `strictfp` improves numerical precision on Java 21 |

`var names = new ArrayList<String>();` infers `ArrayList<String>`, and that type stays fixed. `var value = null;` cannot infer a type. Prefer an explicit type when the initializer obscures the contract; inference is not a reason to expose an implementation type throughout an API.

### Access is a boundary, not just a modifier checklist

| Access | Who can use it? | Practical use |
| --- | --- | --- |
| `private` | Code within the enclosing top-level type's nest, including its nested types | Protect implementation details; a same-named subclass method does not override a private method |
| Package-private | Code in the same package | Package-internal collaborators; subpackages are different packages |
| `protected` | Same-package code, plus qualifying subclass access across packages | Extension hooks, not a general "subclass can access every parent object" permission |
| `public` | Code that can also access the declaring type, subject to module boundaries | Deliberate external contract |

**Cross-package protected trap:** inside subclass `Child`, `this.value` and access through a `Child`-typed receiver can qualify for an inherited protected instance member. Access through an arbitrary `Parent`-typed receiver does not qualify just because the code is inside `Child`. Same-package access follows the package rule instead. The inherited member does not literally change into a private declaration.

Here is the concrete relationship from the original notes, with the misleading "becomes private" wording removed:

```java
// File: base\Parent.java
package base;

public class Parent {
    protected int value = 10;
    int packageValue = 20;
}
```

```java
// File: app\Child.java
package app;

import base.Parent;

public class Child extends Parent {
    int read(Child other) {
        return this.value + other.value;
    }

    // int readParent(Parent other) { return other.value; } // Illegal here.
    // int readPackageValue() { return packageValue; } // Different package.
}
```

A non-subclass `Neighbor` in package `app` does not gain access to `value` just because `Child` inherits it. A subclass of `Child` can use the appropriate inherited protected access. **Recall:** same package is one access route; subclass access across packages is another, restricted route.

**Scenario:** code compiled before a Java upgrade, but reflective access now throws `InaccessibleObjectException`. Java 9 introduced modules, and Java 17 strongly encapsulates JDK internals. `exports` exposes a package's public API; `opens` permits deep reflection. Check the library version and intended module configuration before reaching for `--add-opens`; do not treat that flag as a permanent substitute for supported APIs.

**Interview follow-up:** "Does a getter/setter pair guarantee encapsulation?" No. A setter that accepts an invalid balance or a getter that returns a mutable internal list still leaks invariants. Prefer operations such as `debit(amount)` that enforce business rules over unrestricted field-shaped setters.

## 4. Values, variables, conversions and pass-by-value

### Foundation: a variable holds a value, not necessarily an object

A primitive variable holds a primitive value. A reference variable holds either null or a reference to an object/array; it does not contain the whole object. Assigning one reference to another copies the reference, so both can reach the same object. Creating a second variable does not create a second object.

| Primitive | Value model | Default for a field or array element |
| --- | --- | --- |
| `byte` | Signed 8-bit integer | `0` |
| `short` | Signed 16-bit integer | `0` |
| `int` | Signed 32-bit integer | `0` |
| `long` | Signed 64-bit integer | `0L` |
| `float` | 32-bit IEEE 754 floating point | `0.0f` |
| `double` | 64-bit IEEE 754 floating point | `0.0d` |
| `char` | Unsigned 16-bit UTF-16 code unit | `'\u0000'` |
| `boolean` | `true` or `false`, no numeric truthiness | `false` |

Reference fields/elements default to null. A local variable does **not** get a usable default: `int count;` is a declaration, but reading it before definite assignment is a compile-time error. In `int[] counts = new int[2];`, the local reference is explicitly assigned and its two array elements receive zero defaults.

**Scope is not lifetime.** Scope says where a name can be used in source. Reachability says whether an object can still be used by the running program. A block-local reference can go out of scope while its object remains reachable from a field or callback.

```java
class VariableBaseline {
    private int count = 10;
    private static int total;

    void setCount(int count) {
        this.count = count;
        total++;
    }
}
```

The parameter shadows the field: `count` means the parameter and `this.count` means the receiver's field. Each instance has its own field, while `total` belongs to the class. A static method has no `this`; it needs an explicit object reference to access instance state.

### Foundation: literals and numeric conversions

`42`, `0b101010`, `052` and `0x2A` all denote integer forty-two; the latter three use binary, octal and hexadecimal notation. A leading zero matters. `42L` is long; `1.5` is double; `1.5f` is float. `'\u004E'` and `'N'` represent the same char. Literal length is constrained by its type and syntax, not the original notes' oversimplified fixed digit counts.

For primitive numeric widening, remember `byte -> short -> int -> long -> float -> double`, with `char -> int` joining that chain. There is no implicit `short <-> char` conversion and boolean is outside it. A wider range does not necessarily mean exact precision.

```java
class ConversionBaseline {
    static void compare() {
        byte left = 1;
        byte right = 2;
        int sum = left + right;
        // byte small = left + right; // Promoted int is not implicitly narrowed.
        byte constant = 1 + 2;
        byte wrapped = (byte) 130;
        left += right;
        System.out.println(sum + ":" + constant + ":" + wrapped + ":" + left);
        // 3:3:-126:3
    }
}
```

A representable constant expression can narrow in an assignment; the variables in `left + right` are not constant expressions. Compound assignment includes a conversion back to the left-hand type, so `left += right` compiles but can silently overflow. An explicit narrowing cast accepts possible information loss; it is not range validation.

### What stayed stable?

Java has eight primitive types and reference types. Fields and array elements receive default values; local variables must be definitely assigned before use. `final` prevents reassignment after initialization, not mutation of an object reached through the reference.

| Topic | Historical rule or change | Practical consequence |
| --- | --- | --- |
| Integer arithmetic | `byte`, `short` and `char` generally promote to `int` in arithmetic | `byte a = 1; byte b = 2;` does not make `a + b` a byte |
| Literals | Java 7 added binary literals and underscores in numeric literals | `0b1010` is ten; `1_000` is one thousand; leading-zero `010` is still octal eight |
| Numeric widths | `int` is 32-bit, `long` 64-bit, `char` an unsigned 16-bit UTF-16 code unit | A `char` need not represent a complete Unicode character |
| Floating literals | Unsuffixed floating-point literals are `double`; `float` needs `f` | Narrowing can lose precision |
| Boxing | Java 5 added autoboxing and unboxing | Convenience can hide allocation, reference equality and null-unboxing failures |
| Inference | Java 10 added local `var` | `var count = 1` is an `int`, not an automatically growing numeric type |

Not every widening conversion preserves precision: a large `long` converted to `double` can lose low-order digits. Narrowing integral conversions can discard high-order bits without throwing. Floating-to-integral conversions have additional truncation/range rules; do not generalize "all casts just discard bits" to every numeric conversion.

Use uppercase `L` for long integer literals to avoid confusing lowercase `l` with `1`; a destination variable's type does not retroactively change the types of its subexpressions. Java specifies boolean values, not a portable per-variable storage size you can use to calculate an object's memory footprint.

**Modifier correction:** `volatile` and `transient` apply to fields, not local variables. Both `static volatile` and `static transient` are legal declarations, although transient adds no default instance-serialization benefit to an already-static field. A field cannot be both final and volatile. `final` can also qualify parameters and locals; it still does not freeze referenced state.

```java
class NumericExamples {
    static long incorrectMillis(int seconds) {
        return seconds * 1_000;
    }

    static long checkedMillis(int seconds) {
        return Math.multiplyExact((long) seconds, 1_000L);
    }
}
```

For `3_000_000` seconds, the first method overflows the **int multiplication before** widening the result to long. The second performs long arithmetic. `Math.addExact`/`multiplyExact` were added in Java 8 and throw on overflow of the selected numeric type.

**Interview follow-up:** "`int` overflows, so does Java throw?" Ordinary integer arithmetic wraps; exact-arithmetic APIs throw. Integral division by zero throws `ArithmeticException`; floating-point division by zero can produce infinity or NaN.

### Java always passes arguments by value

For an object parameter, the copied value is a reference. Both references can reach the same mutable object, but reassigning the parameter does not reassign the caller's variable:

```java
import java.util.ArrayList;
import java.util.List;

class PassingValues {
    static void change(List<String> values) {
        values.add("shared mutation");
        values = new ArrayList<>();
        values.add("local replacement");
    }
}
```

If the caller passes an initially empty mutable list, it ends with only `"shared mutation"`. Java 21 did not change this into pass-by-reference. Whether a JVM internally represents references as pointers, handles or compressed references is not the language-level argument-passing contract.

### Wrappers, parsing and nulls

Wrappers such as `Integer` are objects that represent primitive values. Boxing converts `int` to `Integer`; unboxing retrieves the int, implicitly or via `intValue()`. `Number` conversions such as `longValue()`/`doubleValue()` convert numeric values; narrowing through `byteValue()` can still lose information.

`Integer.parseInt("42")` returns an `int`; `Integer.valueOf("42")` returns an `Integer`. `valueOf` may reuse a cached object, so the source's "always newly created" claim is incorrect. Use `equals` or unbox deliberately for numeric value comparisons, not `==` between wrappers.

Parsing consumes text in the expected format; invalid/out-of-range input throws `NumberFormatException`, not a magic default value. `Integer.parseInt("ff", 16)` produces 255, while `Integer.toHexString(254)` produces `"fe"`. The text is a representation; the int itself has no decimal-versus-hex identity.

For `valueOf`, the standard APIs cache all Boolean/Byte values, Character values in 0–127, and Short/Integer/Long values in -128–127, with some allowing additional caching. This explains the old identity examples, not a reason to compare wrapper objects using `==`.

Small-value identity reuse explains why a broken `Integer` identity comparison may appear to work in a test. Do not rely on larger values always being different objects either. `Objects.equals(a, b)` handles nulls but still respects type-specific equality: `Integer.valueOf(1)` is not equal to `Long.valueOf(1)`.

**Real symptom:** a nullable `Integer retries` causes `if (retries > 0)` to throw `NullPointerException` while unboxing. Decide explicitly whether missing means invalid, unknown or a documented default; boxing is not null handling.

## 5. Inheritance, overload resolution, overriding and casts

### Foundation: IS-A, HAS-A and what the reference lets you call

**IS-A:** a subtype can be used through a parent class/interface contract. **HAS-A:** one object holds a reference to a collaborator and delegates work to it. Inheritance supplies a subtype relationship; composition supplies collaboration without requiring the same hierarchy.

With `Delivery delivery = new ExpressDelivery()`, there is one `ExpressDelivery` object. `Delivery` is the variable's compile-time type; `ExpressDelivery` is the object's runtime class. The declared type does not change when the reference is reassigned to another compatible object. The object can have additional methods that this reference does not expose.

This distinction explains both casts and dispatch: first ask **"is this operation available through the declared type?"**, then **"which implementation of the selected instance method runs?"** Fields and static methods do not use that second virtual-dispatch step.

**Encapsulation, coupling and cohesion:** private state plus invariant-preserving operations lets an implementation change without forcing callers to know its representation. Loose coupling means depending on a small, stable collaborator contract; high cohesion means the class's state/operations support one focused responsibility. A class that formats reports, sends email and manages JDBC connections is not cohesive merely because all three methods are private.

### Separate compile-time selection from runtime dispatch

Java 5 introduced covariant reference return types for overrides and added boxing/varargs to overload resolution. The central distinction remains unchanged through Java 21:

| Question | Decided using |
| --- | --- |
| Which overload signature applies? | Compile-time types of the receiver and arguments, plus overload-resolution rules |
| Which override runs for that signature? | Runtime class of the receiver for an overridable instance call |
| Which field or static method is selected? | Compile-time type/name resolution, not virtual instance dispatch |

```java
class Delivery {
    String send(Object message) {
        return "base-object";
    }

    String send(String message) {
        return "base-string";
    }
}

class ExpressDelivery extends Delivery {
    @Override
    String send(Object message) {
        return "express-object";
    }
}

class DispatchExample {
    static String result() {
        Delivery delivery = new ExpressDelivery();
        Object message = "hello";
        return delivery.send(message);
    }
}
```

The result is `"express-object"`. The compiler selects `send(Object)` because `message` is declared `Object`; runtime dispatch then finds that signature's override. It does not switch to `send(String)` because the argument happens to contain a string.

### Override rules worth explaining, not just memorizing

1. The argument list must exactly match that of the overridden method. If they don't match, you can end up with an overloaded method you didn't intend.
2. The return type must be the same as, or a subtype of, the return type declared in the original overridden method in the superclass. The access level can't be more restrictive than the overridden method's.
3. Instance methods can be overridden only if they are inherited by the subclass. A subclass within the same package as the instance's superclass can override any superclass method that is not marked private or final. A subclass in a different package can override only those non-final methods marked public or protected (since protected methods are inherited by the subclass).
4. The overriding method CAN throw any unchecked (runtime) exception, regardless of whether the overridden method declares the exception.
5. The overriding method must NOT throw checked exceptions that are new or broader than those declared by the overridden method. For example, a method that declares a FileNotFoundException cannot be overridden by a method that declares a SQLException, Exception, or any other non-runtime exception unless it's a subclass of FileNotFoundException.
6. The overriding method can throw narrower or fewer exceptions. Just because an overridden method "takes risks" doesn't mean that the overriding subclass' exception takes the same risks. Bottom line: an overriding method doesn't have to declare any exceptions that it will never throw, regardless of what the overridden method declares.
7. You cannot override a method marked final.
8. You cannot override a method marked static.
9. If a method can't be inherited (because it’s private), you cannot override it. Remember that overriding implies that you're reimplementing a method you inherited!
10. Using super to invoke an overridden method only applies to instance methods.
11. A subclass uses super.overriddenMethodName() to call the superclass version of an overridden method.
12. Use `@Override` so a mistaken parameter change is caught as a compilation error.

**Substitutability scenario:** a subtype accepts fewer valid inputs or throws `UnsupportedOperationException` for a core operation that its parent promises. Compilation alone does not make that inheritance relationship sound. Reconsider the contract or use composition.

### Overloading traps: the old shortcut is not the complete algorithm

1. Overloaded methods MUST change the argument list.
2. Overloaded methods CAN change the return type.
3. Overloaded methods CAN change the access modifier.
4. Overloaded methods CAN declare new or broader checked exceptions.
5. A method can be overloaded in the *same* class or in a *subclass*. In other words, if class A defines a doStuff(int i) method, the subclass B could define a doStuff(String s) method without overriding the superclass version that takes an int. So two methods with the same name but in different classes can still be considered overloaded, if the subclass inherits one version of the method and then declares another overloaded version in its class definition.
6. The choice of which overloaded method to call (in other words, the signature of the method) is NOT dynamically decided at runtime. Just remember, the *reference* type (not the object type) determines which overloaded method is invoked!
7. So it's true that polymorphism doesn't determine which overloaded version is called; polymorphism does come into play when the decision is about which overridden version of a method is called.
8. **In every case, when an exact match isn't found, the JVM uses the method with the smallest argument that is wider than the parameter.**
9. **For overloaded methods the calling is done in the following order of preference**
           **a.      Widening**
**b.      Boxing**
**c.       Var args**
10. Primitive widening uses the "smallest" method argument possible.
11. Used individually, boxing and var-args are compatible with overloading.
12. You CANNOT widen from one wrapper type to another. (IS-A fails.)
13. You CANNOT widen and then box. (An int can't become a Long.)
14. You can box and then widen. (An int can become an Object, via Integer.)
15. You can combine var-args with either widening or boxing.
For common primitive cases, the mnemonic "widening before boxing before varargs" helps. More precisely, the compiler first considers fixed-arity applicability without boxing/unboxing, then fixed-arity applicability with those conversions, then variable-arity applicability; it selects a most-specific applicable method within the relevant phase. An existing array argument can make a varargs declaration applicable as fixed-arity.

`choose(long)` beats `choose(Integer)` for an `int` argument. But `choose(String)` and `choose(Integer)` make `choose(null)` ambiguous because neither reference type is more specific than the other. Return type alone cannot distinguish overloads. Avoid overload sets that make routine nulls or lambdas ambiguous.

Varargs arrived in Java 5: only the last parameter can be variable-arity, and inside the method it is an array. A caller can pass an explicit array; changing its elements can therefore mutate caller-owned data.

#### Rebuild the conversion steps instead of memorizing a winner

| Argument and parameter | Allowed for method invocation? | Why |
| --- | --- | --- |
| `int` argument -> `long` parameter | Yes | Primitive widening |
| `int` -> `Integer` | Yes | Boxing |
| `int` -> `Object` | Yes | Box to Integer, then widen the reference |
| `Integer` -> `long` | Yes | Unbox to int, then widen the primitive |
| `int` -> `Long` | No | Widening primitive then boxing is not such an invocation conversion |
| `Integer` -> `Long` | No | Wrapper classes are not a numeric inheritance chain |
| `int` -> `byte` | No, not implicitly | Even a small literal argument is not assignment-context constant narrowing |

For `void record(String category, int... values)`, these are valid calls: `record("retry")`, `record("retry", 1, 2)` and `record("retry", new int[]{1, 2})`. The first supplies an empty array, not null. The explicit `record("retry", (int[]) null)` supplies null; there is no automatic conversion to an empty array inside the method.

| Comparison | Overloading | Overriding |
| --- | --- | --- |
| Parameters | Must differ, subject to erasure/signature rules | Must match the inherited signature as required |
| Return | Can differ, but cannot distinguish overloads by itself | Same or covariant reference return; not arbitrary primitive changes |
| Checked exceptions | Each overload has its own declaration | Cannot add broader/new checked exceptions |
| Access | Each overload has its own access | Cannot reduce inherited access |
| Selection | Compile-time applicability selects a signature | Runtime receiver selects its overriding implementation |

### Casts do not transform objects

Upcasting usually needs no explicit cast. Downcasting checks whether the runtime object supports the requested type and can throw `ClassCastException`; it does not construct a new object or change its class. Casting null to a reference type yields null.

#### Foundation: a cast changes the view, not the object

```java
class AnimalView {
    String sound() { return "animal"; }
}

class DogView extends AnimalView {
    @Override
    String sound() { return "dog"; }
    String fetch() { return "ball"; }
}

class CastRecall {
    static void show() {
        AnimalView animal = new DogView();
        System.out.println(animal.sound()); // dog
        // animal.fetch(); // Not available through AnimalView.
        DogView dog = (DogView) animal;
        System.out.println(dog.fetch()); // ball
        System.out.println(animal == dog); // true: the same object.
    }
}
```

Walk it in order: `new DogView()` determines the object's class; assigning to `AnimalView` widens the reference's view; overriding still supplies `DogView.sound()`. Casting back succeeds because the object really is a DogView. By contrast, `(DogView) new AnimalView()` is a legal cast expression at compilation but throws at execution: a plain AnimalView is not a DogView.

The compiler rejects casts it can prove impossible, such as a String to an unrelated final class. Interface relationships can leave more possibilities open, so "same inheritance tree" is not a complete cast-validity algorithm. Use a checked type test when input legitimately has several shapes; repeated downcasts to call implementation-only methods may instead indicate a poor contract.

Java 16 standardized pattern matching for `instanceof`:

```java
class TypeInspection {
    static int textLength(Object value) {
        if (value instanceof String text) {
            return text.length();
        }
        return 0;
    }
}
```

`instanceof` returns false for null. The pattern variable's scope follows where the match is known to have succeeded; it is not available on arbitrary paths afterward. Here zero is a deliberately defined result for non-strings, not an exception-catching fallback.

**Interview follow-up:** "Why does casting `List<Integer>` to `List<String>` not validate every item?" Generic type arguments are generally erased; unchecked casts cannot establish the element-level contract. Fix the data boundary rather than hiding the warning.

## 6. Initialization, static state, JVM memory and garbage collection

### Foundation: constructing one object walks a constructor chain

A constructor has the class name and no return type, not even void. `void Account()` is a method, not a constructor. A compiler-provided **default constructor** exists only when the class declares no constructor; it is not the same thing as every explicitly written no-argument constructor.

Through Java 21, a constructor either starts by calling another constructor in the same class with `this(...)` or its immediate superclass with `super(...)`, explicitly or through an inserted no-arg `super()`. It cannot directly call both. A same-class chain must eventually reach superclass construction.

If a parent has only `Parent(int id)`, an implicit `super()` fails: the child must provide a constructor path that calls the accessible `super(id)`. Constructors can be overloaded and declare exceptions, but are never inherited or overridden.

```java
class InitParent {
    static { System.out.println("parent static"); }
    { System.out.println("parent instance"); }
    InitParent() { System.out.println("parent constructor"); }
}

class InitChild extends InitParent {
    static { System.out.println("child static"); }
    private int value = initialValue();
    { System.out.println("child instance " + value); }

    InitChild() {
        this(7);
        System.out.println("child no-arg body");
    }

    InitChild(int id) {
        super();
        System.out.println("child constructor " + id);
    }

    private int initialValue() {
        System.out.println("child field");
        return 3;
    }
}
```

For the first `new InitChild()` in a fresh execution context:

```text
parent static
child static
parent instance
parent constructor
child field
child instance 3
child constructor 7
child no-arg body
```

A second construction repeats the instance/constructor lines, not the static lines. The child field initializer and instance block run in textual order, once per constructed object, not once per `this(...)` hop. Parent and child state belong to that **one object**, whose fields initially receive defaults before these constructor steps. Section 2's constructor-dispatch trap follows directly from this sequence.

### Initialization is not the same event as loading

The source says static initializers run when a class is first loaded. Refine that: **class initialization** runs static field initializers and static blocks, in textual order, after required superclass initialization. Loading/linking and initialization are distinct JVM phases. A class can be loaded without its static initializer executing yet.

Creating an instance, invoking a declared static method or accessing a non-constant static field can trigger initialization. Reading a compile-time constant may not: the compiler can inline it into the caller. Changing a published constant may therefore require recompiling consumers.

For ordinary instance construction, after memory is allocated and fields have default values, superclass construction runs before the current class's instance field initializers/initializer blocks and constructor body. Section 2's overridable-constructor call demonstrates why default field values can be observed too early. `this(...)` chaining does not run instance initializers repeatedly for the same object.

**Static scope:** one static field is associated with a class as defined by its class loader, not necessarily one per JVM and certainly not one per application cluster. A `static Map` cache is neither automatically thread-safe nor shared between application replicas.

### The memory model versus implementation optimizations

| Area | Useful mental model | Caveat |
| --- | --- | --- |
| Thread stack | Frames for method calls, local values and operand stacks | A reference local is not the referenced object |
| Heap | Shared object/array storage in the JVM model | JIT escape analysis may eliminate allocations or scalar-replace objects |
| Class metadata | Runtime class information; HotSpot uses Metaspace since Java 8 | Metaspace is a HotSpot implementation detail, not a language keyword |
| Reachability | An object can be reclaimed when no longer reachable through relevant roots | Lexical scope ending does not guarantee immediate collection |

The source's "all locals live on the stack, all objects always physically live on the heap" is too literal for an optimizing runtime. Equally, a local reference disappearing does not destroy an object that a cache, callback or another object still retains.

**Scenario:** memory keeps growing even though Java has GC. An unbounded map retains every request result, so those results remain reachable. GC cannot infer that the business no longer needs them. Bound caches and inspect retention paths rather than adding `System.gc()`.

### GC does not manage external resource ownership

Use try-with-resources for files, sockets and database connections; GC timing is not a release protocol. Finalization was deprecated in Java 9 and deprecated for removal in Java 18. Through Java 21, do not design around `finalize()`; a `Cleaner` is at most a fallback, not deterministic cleanup.

**Interview follow-up:** "`OutOfMemoryError` versus `StackOverflowError`?" Heap/native/class-metadata exhaustion and deep recursive stack growth are different failure modes. Check the exact error, heap/class histograms, GC logs, thread dumps and Java Flight Recorder data. A larger heap does not fix a runaway recursion or retained references.

Java 9 introduced unified JVM logging, for example `-Xlog:gc*`. HotSpot Java 21 normally uses G1 as the default on server-class configurations; collector choice and flags depend on runtime/distribution. Choose from measured pause, throughput and footprint goals, not "the newest GC is always best."

For the collector-evolution timeline, algorithm trade-offs, GC-log workflow and production diagnosis scenarios, see [Garbage collection and JVM performance](Java-Exceptions-Generics-IO-Serialization.md#5-garbage-collection-and-jvm-performance).

## 7. Nested types, captured variables and enums

### Nested is the broad term; inner is a specific relationship

| Kind | Enclosing-instance relationship | Typical use |
| --- | --- | --- |
| Static nested class | No implicit outer instance; can use one passed explicitly | A helper or builder grouped with its owning API |
| Non-static member inner class | Associated with an enclosing object | A helper genuinely tied to that object's state |
| Local class | Declared within a block; enclosing-instance access depends on context | A small local implementation |
| Anonymous class | Unnamed class created in an expression | A one-off implementation or subclass |

`outer.new Inner()` constructs a non-static member inner instance. Inside it, `this` is the inner object and `Outer.this` identifies the enclosing object. Both nested and enclosing code can access private members within their nest; static context still needs an object reference to use instance state.

### Foundation: connect nested-class syntax to the object relationship

```java
class EnclosingExample {
    private String name = "outer";

    class Inner {
        private String name = "inner";

        String describe() {
            return this.name + ":" + EnclosingExample.this.name;
        }
    }

    static class Nested {
        String describe(EnclosingExample owner) {
            return owner.name;
        }
    }

    static void compare() {
        EnclosingExample outer = new EnclosingExample();
        EnclosingExample.Inner inner = outer.new Inner();
        EnclosingExample.Nested nested = new EnclosingExample.Nested();
        System.out.println(inner.describe()); // inner:outer
        System.out.println(nested.describe(outer)); // outer
    }
}
```

`outer.new Inner()` binds the inner object to that outer object. `new EnclosingExample.Nested()` does not: its method needs an owner passed explicitly. `static` changes the nesting relationship; it does not mean every field/method inside `Nested` is static.

A local class's name is available only in its block after its declaration. An anonymous class skips the reusable name and constructs the instance in the same expression:

```java
class LocalAndAnonymous {
    static Runnable localTask(String requestId) {
        class RequestTask implements Runnable {
            @Override
            public void run() {
                System.out.println(requestId);
            }
        }
        return new RequestTask();
    }

    static Runnable anonymousTask(String requestId) {
        return new Runnable() {
            @Override
            public void run() {
                System.out.println(requestId);
            }
        };
    }
}
```

The `};` closes an anonymous class body **and** the return statement. A use such as `new Thread(new Runnable() { ... });` ends with `});` because the object expression is also a constructor argument. Both tasks above can run after their factory method returns: they capture the value of the effectively-final parameter.

An anonymous creation names either a class to subclass or an interface to implement; it has no declaration header where you can add an extra `implements` list. It can still inherit interfaces through its superclass. It has no named constructor; use arguments to the superclass constructor and, if needed, an instance initializer.

**Historical changes:** Java 5–7 required captured local variables to be explicitly final. Java 8 permits **effectively final** captured locals: assigned once and not subsequently reassigned. Java 16 relaxed restrictions so inner classes can declare static members and static initializers; the old "an inner class can only have static constant fields" restriction is no longer current.

Captured local values can outlive the method invocation through the created object. The source's lifetime discussion should not be read as "local classes cannot capture locals": final/effectively-final capture is exactly how this works. Capturing a final reference does not freeze its target.

**Real symptom:** a listener or scheduled task retains an outer object and its large object graph. An inner implementation can carry an enclosing-instance reference; a lambda can also retain objects it captures. Use a static nested helper or smaller explicit dependencies when an outer instance is not needed, and unregister long-lived callbacks.

With an anonymous class, `this` refers to the anonymous object. In a Java 8 lambda, `this` retains the enclosing meaning. Lambdas implement functional interfaces; they are not a replacement for arbitrary anonymous subclasses with additional state/methods.

**Refinement of the old reference-type rule:** a reference declared as the interface exposes only that interface's members. Since Java 10, `var helper = new Object() { ... };` can infer an anonymous type locally and allow access to its declared members. That does not make the anonymous type nameable in a public API.

#### Recall example: anonymous type locally, named contract in an API

```java
class AnonymousTypeRecall {
    static void demonstrate() {
        var helper = new Object() {
            String format(String name) {
                return "Hello, " + name;
            }
        };
        System.out.println(helper.format("Java")); // Hello, Java

        Object objectView = new Object() {
            String format(String name) {
                return "Hello, " + name;
            }
        };
        // objectView.format("Java"); // Illegal: Object has no format method.
    }

    public static Object createHelper() {
        return new Object() {
            public String format(String name) {
                return "Hello, " + name;
            }
        };
    }

    static void useFactory() {
        var helper = createHelper(); // Inferred as Object.
        // helper.format("Java"); // Still illegal.
    }
}
```

`new Object() { ... }` constructs an instance of an unnamed subclass of Object. In `demonstrate`, `var` retains that anonymous class's precise type, including its extra `format` method. Declaring the variable as Object instead exposes only Object's members; the object's runtime class does not change that compile-time view.

At the factory boundary, the declared return type controls the caller's view. Even though `createHelper` returns an anonymous object with a public `format` method, the caller infers **Object**, not the hidden implementation type. `var` is local-variable type inference, not a legal method return type: `public static var createHelper()` is invalid.

For a reusable API, name the capability rather than trying to expose the anonymous type:

```java
public class FormatterFactory {
    public interface Formatter {
        String format(String name);
    }

    public static Formatter createHelper() {
        return name -> "Hello, " + name;
    }

    static void demonstrate() {
        var helper = createHelper(); // Inferred as Formatter.
        System.out.println(helper.format("Java")); // Hello, Java
    }
}
```

Here the implementation can remain a lambda (or an anonymous implementation), while the public contract is the named `Formatter` interface. **Recall:** `var` preserves what the initializer's compile-time type provides; it does not discover extra methods from an object's runtime class.

### Enums are domain alternatives, not magic thread-safe objects

Java 5 introduced enums. Each constant is a singleton instance of its enum type within its class-loader context. Enums can have fields, private constructors, methods, constant-specific behavior and implemented interfaces; they cannot explicitly extend another class.

```java
enum TicketState {
    OPEN, CLOSED;

    boolean canAcceptComment() {
        return this == OPEN;
    }
}
```

Using `==` for enum identity is appropriate. `Enum.valueOf` is case-sensitive and throws for an unknown name; map external input deliberately. Do not persist `ordinal()` as a durable code: reordering constants changes its meaning. Names also need a migration policy if renamed; explicit stable external codes are often safer.

#### Foundation: constant declarations construct the predefined objects

```java
enum ShippingChoice {
    STANDARD(5),
    EXPRESS(15) {
        @Override
        String label() { return "Priority delivery"; }
    };

    private final int fee;

    ShippingChoice(int fee) {
        this.fee = fee;
    }

    int fee() { return fee; }
    String label() { return "Standard delivery"; }
}
```

`STANDARD(5)` and `EXPRESS(15)` supply arguments to the enum constructor. The semicolon separates the constants from ordinary members. Callers select `ShippingChoice.EXPRESS`; they cannot construct `new ShippingChoice(15)`. The constant-specific body overrides behavior for EXPRESS, while both constants retain the enum's shared data contract.

This is useful for a fixed choice with different policies; a caller can pass varying inputs to a policy method without mutating the constant. It is not a substitute for a record representing each shipment. Section 1's enum-versus-record comparison distinguishes predefined instances from runtime-created values.

**Version correction:** the old source says enums cannot be local. Java 16 supports local enum and record declarations; they are implicitly static. A member enum is also implicitly static. Top-level declaration/access rules differ from member rules.

**Interview follow-up:** "Is an enum singleton automatically thread-safe?" Initialization safely creates the constant, but mutable fields inside it still need concurrency control. One enum instance is not a distributed lock across servers.

## 8. Immutability, records and the equality contract

### Earlier recipe, modern data carriers

The Java 5–7 advice remains useful: prevent uncontrolled subclass behavior, validate construction, keep state private, avoid mutation, and defend mutable boundaries. `final` fields and absence of setters are not enough if callers can mutate referenced objects.

1. No setter methods.
2. All fields are final, private.
3. Class is final.
4. If members are mutable objects then Don’t provide methods to modify them. and Assign passed references by copying, similarly create a copy while returning the mutable objects

### Foundation: defensive copying protects both directions

Suppose a value class stores a caller's mutable `Date`. A private final field only prevents reassignment of that reference: the caller could still mutate the supplied Date, or mutate it through a getter returning the same object. For this legacy type, copy on **input and output**:

```java
import java.util.Date;
import java.util.Objects;

final class LegacyAppointment {
    private final Date when;

    LegacyAppointment(Date when) {
        this.when = new Date(Objects.requireNonNull(when, "when").getTime());
    }

    Date when() {
        return new Date(when.getTime());
    }
}
```

Now neither changing the original Date nor a returned Date changes the appointment. Prefer an immutable time type such as `Instant` for a new design. The principle is ownership of mutable state, not "every getter must allocate." An unmodifiable collection wrapper alone does not copy mutable elements, and a final class alone does not stop its own methods from mutating fields.

### Java 16 records build on the value-class model

Java 9 added collection factories; Java 10 added `copyOf` factories. Java 16 standardized records after previews in Java 14/15. Records generate a canonical constructor, component accessors, `equals`, `hashCode` and `toString`; they are final and extend `java.lang.Record`, but may implement interfaces.

```java
import java.util.List;

record ReportSpec(String title, List<String> columns) {
    ReportSpec {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title is required");
        }
        columns = List.copyOf(columns);
    }
}
```

The compact constructor validates and normalizes inputs before the implicit component assignments. `List.copyOf` rejects null collections/elements and provides an unmodifiable list whose contents do not track later structural changes to the caller's list. Because these elements are immutable strings, they do not expose mutable element state. Mutable element types would still require deeper protection.

**Records are shallowly immutable:** component fields are final references, not recursive freezing. A record containing an array both exposes that mutable array through its default accessor and uses the array's identity-based equality by default. Choose immutable component types or deliberately define copying and equality semantics.

**Trade-off:** records fit DTOs/value aggregates well, not every mutable entity or inheritance hierarchy. Generated `toString` includes component values: never assume it redacts credentials or confidential fields.

### Identity, logical equality and hashing

`==` compares reference identity for objects. `Object.equals` defaults to identity, but classes can define value equality. The equality contract is reflexive, symmetric, transitive, consistent while relevant state is unchanged, and false for null.

#### Foundation: decide what makes two domain values the same

Two separately constructed values can represent the same business value without being the same Java object. Ordinary classes do not infer that rule from their fields; you define it. Records generate a component-based rule, which is appropriate only if those components express your intended value.

```java
import java.util.Objects;

final class DocumentCode {
    private final String value;

    DocumentCode(String value) {
        this.value = Objects.requireNonNull(value, "value");
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof DocumentCode)) {
            return false;
        }
        DocumentCode that = (DocumentCode) other;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }
}
```

For `DocumentCode first = new DocumentCode("R-1")` and a second separately constructed `"R-1"` code, `first == second` is false while `first.equals(second)` is true. `first.equals(null)` is false. This Java 8-compatible implementation makes the equality decisions explicit; a record generates component-based equality instead.

**Signature trap:** `equals(DocumentCode other)` would overload rather than override `Object.equals(Object)`. Calls through Object-typed references would then use Object's identity behavior. `@Override` catches the mistake. Making this value class final also avoids an equality policy that becomes asymmetric when a subclass adds extra equality-significant state.

**Hash rule:** if two values are equal, they must have the same hash code. Unequal values may collide. Override `hashCode` whenever you override value-based `equals`; never assume a unique hash is an identifier.

```java
import java.util.HashMap;
import java.util.Map;

record ReportKey(String tenant, String reportId) { }

class KeyLookup {
    static String find() {
        Map<ReportKey, String> reports = new HashMap<>();
        reports.put(new ReportKey("tenant-a", "r-1"), "ready");
        return reports.get(new ReportKey("tenant-a", "r-1"));
    }
}
```

The result is `"ready"` because these record instances have equal components and corresponding hashes.

**Failure scenario:** a map key's fields used by `equals`/`hashCode` change after insertion. A lookup can fail because the key now hashes differently from where it was stored. Prefer immutable keys rather than removing/reinserting mutable keys throughout the codebase.

**Interview follow-up:** "What if `compareTo` returns zero for unequal objects?" Sorted sets/maps use comparison to identify equivalent keys, so one may replace or exclude the other. Keep ordering consistent with equality unless the API explicitly documents the difference. `BigDecimal("1.0")` and `BigDecimal("1.00")` are the classic case: numerically equal by `compareTo`, not equal by `equals`.

## 9. Generics: type-safe APIs and the limits of erasure

This topic has moved to the companion guide: [Exceptions, Generics, I/O and Serialization](Java-Exceptions-Generics-IO-Serialization.md). Use that guide for the full explanations and examples.

## 10. Collections: choose semantics before implementation

**Deferred:** retained material; revise and study in the dedicated collections document, not this pass.

### Historical baseline and additions

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

`LinkedList` can unlink a node efficiently once positioned, but finding an index is linear, with allocation/locality overhead. "Lots of inserts means linked list" is not a sufficient performance argument.

### Fixed-size, unmodifiable and immutable are different

`Arrays.asList(array)` returns a fixed-size list backed by that array: `set` works and affects the backing array, but structural `add/remove` do not. `Collections.unmodifiableList(source)` is a read-only **view**, so source changes remain visible.

`List.of` and `List.copyOf` are unmodifiable; neither makes mutable elements immutable. These factories reject null elements. `Set.of` rejects duplicates; `Map.of` rejects duplicate keys and null keys/values. Do not assume their iteration order is insertion order. Use an appropriate ordered implementation when order is part of the output contract.

### Java 21 sequenced collections: a useful API change

`SequencedCollection`, `SequencedSet` and `SequencedMap` represent encounter order. Lists, linked ordered sets/maps and sorted collections fit into the relevant interfaces; plain hash collections do not acquire a meaningful order.

```java
import java.util.ArrayList;
import java.util.List;

class SequencedExample {
    static List<String> queueOrder() {
        var queue = new ArrayList<>(List.of("first", "second"));
        queue.reversed().addFirst("third");
        return List.copyOf(queue);
    }
}
```

The result is `["first", "second", "third"]`: adding at the front of the reversed **view** adds at the end of the original. `reversed()` is not a detached copy. Endpoint mutation is optional; sorted collections cannot accept arbitrary explicit positioning that would violate sorting, and unmodifiable lists still reject mutation. `getFirst/getLast` throw on an empty list.

### Iteration and concurrent updates

Ordinary fail-fast iterators may throw `ConcurrentModificationException` for unsupported structural changes, including changes by the **same thread**. This is best-effort bug detection, not a concurrency guarantee. Use an iterator's supported removal, `removeIf`, or build a new collection.

`ConcurrentHashMap` iterators are weakly consistent, not frozen snapshots. `CopyOnWriteArrayList` offers snapshot-style iteration and expensive writes; it fits rare-write/frequent-read workloads, not a high-volume write queue.

**Interview follow-up:** "Can I do `if (!map.containsKey(k)) map.put(k, v)` safely on a concurrent map?" Individual calls may be thread-safe, but that sequence is not atomic. Use `putIfAbsent`, `compute` or another operation matching the requirement. Keep compute callbacks short and free of recursive updates; do not assume arbitrary remote side effects become exactly-once.

## 11. Strings, formatting, precise numbers and dates

### Strings: immutable values, not identity tokens

#### Foundation: changing a variable is different from changing a String

```java
class StringRecall {
    static void show() {
        String text = "java";
        String alias = text;
        text.toUpperCase(java.util.Locale.ROOT);
        System.out.println(text); // java: result was not assigned.
        text = text.toUpperCase(java.util.Locale.ROOT);
        System.out.println(text); // JAVA
        System.out.println(alias); // java: original value is unchanged.

        String literal = "ready";
        String sameLiteral = "rea" + "dy";
        String separate = new String("ready");
        System.out.println(literal == sameLiteral); // true
        System.out.println(literal == separate); // false
        System.out.println(literal.equals(separate)); // true
    }
}
```

An immutable object cannot have its value changed by callers; the variable can still be reassigned unless final. String operations return a result rather than altering the original String. They need not allocate a new object when the result can reuse an existing value.

String literals and constant-expression strings are interned, explaining the first identity comparison. `new String("ready")` deliberately creates a distinct String object with equal content. Do not extrapolate literal identity to runtime-built strings; use content comparison. `intern()` can obtain a canonical representation, but ordinary business equality should not depend on callers remembering to intern.

`StringBuilder.append` instead changes the builder's contents. Use a builder when constructing one result through repeated edits; call `toString()` for a String value. `final StringBuilder builder` would still allow append: final constrains the variable, not the target's mutability.

String immutability and literal interning are older than Java 5 and remain in Java 21. `==` can appear to work for interned literals but is not a content comparison; use `equals`. A concatenation involving a string uses textual concatenation, so `"total=" + 1 + 2` gives `"total=12"`, while `"total=" + (1 + 2)` gives `"total=3"`.

Use `StringBuilder` for repeated mutable accumulation in a loop; `StringBuffer` synchronizes individual operations but does not automatically make a larger workflow atomic. Do not prescribe a manual builder for every short `+` expression: the compiler/runtime optimize concatenation.

| Version | Useful addition/change | Practical reason |
| --- | --- | --- |
| Java 8 | `String.join` | Join values without manual delimiter management |
| Java 9 | Compact strings in HotSpot | Internal representation can differ; a `String` is not guaranteed to use a `char[]` internally |
| Java 11 | `isBlank`, `strip`, `lines`, `repeat` | Better text APIs; `strip` uses Unicode-aware whitespace rules rather than `trim`'s older rule |
| Java 15 | Text blocks standardized after previews in Java 13/14 | Readable multiline SQL/JSON/text; indentation and trailing-newline rules still matter |
| Java 18 | UTF-8 became the default charset for most standard APIs | Default-charset assumptions can change during migration; specify boundary encodings |

`String.length()` counts UTF-16 code units, not user-perceived characters. A supplementary code point takes two code units; even code-point counting does not count grapheme clusters such as all combined emoji sequences.

**Scenario:** a username limit rejects some languages/emoji unexpectedly. First decide whether the limit is bytes, code units, code points or displayed graphemes, then implement that contract. Changing `length()` to a different count without agreement can break storage limits.

For machine identifiers use deliberate locale-independent casing, such as `toLowerCase(Locale.ROOT)`. For human-facing sorting/search, use locale-aware rules appropriate to the requirement rather than assuming byte or code-unit ordering is linguistic ordering.

### Formatting is presentation, not numeric storage

Java 5 added `Formatter`/`printf`. The useful shape is `%[argument_index$][flags][width][.precision]conversion`: `%s` text, `%d` decimal integer, `%f` floating-point, `%n` platform newline. Width is normally a minimum; precision has conversion-specific meaning, not universally "digits after the decimal".

#### Foundation: read a format specification from left to right

For `%2$08.2f`: choose argument 2, pad with zeroes, use a minimum width of 8 characters, and display 2 digits after the decimal point using floating-point conversion. Width counts the sign/separators too; it does not truncate a longer number to fit.

| Part | Meaning | Example |
| --- | --- | --- |
| `1$`, `2$` | One-based argument position | `%2$s` formats the second argument as text |
| `-` | Left-align within the field | `%-7d` pads on the right |
| `+` | Include the sign for a numeric conversion | `%+d` produces `+12` for 12 |
| `0` | Numeric zero padding, with a width | `%07d` |
| `,` | Locale-dependent grouping | `%,d` |
| `(` | Parentheses for negative numeric values | `%(d` |
| `.precision` | Conversion-specific precision | `%.2f` fractional digits; `%.3s` maximum text length |
| `%b` | Boolean-style formatting | For a non-Boolean argument: false if null, true otherwise |
| `%c`, `%d`, `%f`, `%s` | Character, integer, floating-point, text conversions | Argument types still have to fit |

```java
import java.util.Locale;

class FormattingBaseline {
    static void show() {
        System.out.printf(Locale.US, ">%1$(7d<%n", -123);
        System.out.printf(Locale.US, ">%1$0,7d<%n", 12345);
        System.out.printf(Locale.US, ">%1$+-7d<%n", 12345);
        System.out.printf(Locale.US, ">%2$b + %1$5d<%n", -123, false);
    }
}
```

```text
>  (123)<
>012,345<
>+12345 <
>false +  -123<
```

This reconstructs the original formatting exercise with valid explicit argument indexes and a fixed locale. `%0,7d` is not the same as `%1$0,7d`: argument indexes require `$`, and zero-padding is a flag. `System.out.format` and `printf` use the same formatting conventions.

Use a specified `Locale` for deterministic machine output. `"%.2f"` rounds displayed text; it does not repair imprecise upstream arithmetic. Format mismatches throw at runtime, so do not feed user-controlled format strings into an internal logging/output contract.

### Money and decimal arithmetic

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

class PriceCalculation {
    static BigDecimal total() {
        return new BigDecimal("19.99")
                .multiply(new BigDecimal("3"))
                .setScale(2, RoundingMode.HALF_UP);
    }
}
```

The result is `59.97`. `new BigDecimal(0.1)` captures the binary floating-point approximation; string construction or appropriate `valueOf` usage avoids that particular surprise. Division may require an explicit scale/rounding policy to avoid `ArithmeticException` for a non-terminating decimal expansion.

**Interview follow-up:** "Should I always use HALF_UP?" No. The currency, jurisdiction and business rule determine scale and rounding. `BigDecimal` is immutable but does not encode those policies for you.

### Java 8 date/time

This subtopic has moved to the companion guide: [Java 8: Lambdas, Streams, Optional and Date/Time](Java-8-Lambdas-Streams-Optional.md#9-the-java-8-date-and-time-api). Use that guide for the full type-selection table and the `Period`/`Duration`/`ChronoUnit`/`TemporalAdjuster` examples.

## 12. Arrays and control flow: from statements to patterns

### Arrays retain their old runtime checks

Arrays have fixed length, default-initialized elements and runtime component types. Multidimensional arrays are arrays of arrays and can be ragged: `new int[3][]` creates an outer array with three initially null row references, not three initialized integer rows.

#### Foundation: declaration, allocation and elements are separate

`int[] values;` declares a reference, `new int[3]` allocates an array, and `values[0] = 7` assigns one element. Valid indexes are zero through `length - 1`; length is a field, not a `length()` method. Invalid indexes throw `ArrayIndexOutOfBoundsException`.

```java
class ArrayBaseline {
    static void inspect() {
        int[][] rows = new int[3][];
        System.out.println(rows.length); // 3
        System.out.println(rows[0] == null); // true
        rows[0] = new int[]{5, 2, 4, 7};
        rows[1] = new int[]{9, 2};
        rows[2] = new int[]{3, 4};
        int[] alias = rows[1];
        alias[0] = 99;
        System.out.println(rows[1][0]); // 99
    }
}
```

There are four array objects after all three rows are assigned: one outer array containing references, and three int arrays containing values. `alias` creates no extra array. A reference array such as `new String[3]` starts with three null references, not three empty String objects.

An initializer like `int[] values = {1, 2};` is allowed at declaration; later assignment needs the array-creation expression `values = new int[]{1, 2};`. Arrays of primitives accept appropriate assignment conversions element by element, but the array reference itself does not widen from `int[]` to `long[]`.

```java
class ArrayChecks {
    static void storeWrongType() {
        Object[] values = new String[1];
        values[0] = 42;
    }
}
```

This compiles but throws `ArrayStoreException` on the assignment. `List<String>` to `List<Object>` is rejected at compile time instead; that difference connects arrays to the companion guide's generics discussion. Primitive arrays do not gain numeric covariance: `int[]` is not a `long[]`.

The source's "array assignments must have the same dimension" rule is too broad: `Object[] rows = new int[2][];` is legal because each row is an `int[]` object reference. Check component-type assignability rather than counting brackets alone.

`Arrays.equals` compares array contents at one level; `Arrays.deepEquals` handles nested object-array contents. Ordinary array `equals` is identity-based. Copying an object array copies references, not a deep object graph.

### Traditional control flow: refine the exam shortcuts

`if`/loop conditions require boolean expressions, not numeric truthiness. `if (flag = true)` is legal assignment and almost certainly not the intended comparison. Enhanced-for arrived in Java 5 for arrays and `Iterable` values.

Unlabelled `break` exits the nearest enclosing loop **or switch**; it does not merely end the current iteration. `continue` advances a loop to its next iteration, including the update expressions in a basic `for`. A labelled `continue` must target a loop; a labelled `break` can also exit a labelled block. The source's "both labels must be loop labels" claim was never generally correct.

**Basic-for execution model:** initialization once -> condition -> body -> update -> condition again. A `continue` in the body goes to the update step; a `break` leaves the loop without that update. Initialization may declare several variables of the same type, such as `int i = 0, j = 3`; the condition is one boolean expression and updates may be comma-separated. A missing condition in `for (;;)` means no condition-based exit.

**Traditional switch mental model:** a matching colon case is an entry point, not an automatically isolated branch. Execution continues through subsequent statements/case labels until a break, return, throw or the switch's end. If no case matches, default is the entry point even if written in the middle; it too can fall through. Arrow rules change that behavior, not the meaning of older colon-style code.

For traditional constant cases, "final" alone does not mean compile-time constant. `final int x = 1` can provide a case constant; `final int x = Integer.parseInt("1")` cannot. Modern pattern cases are a separate extension below.

### The switch timeline

| Version | Capability | What to remember |
| --- | --- | --- |
| Java 5 | Enum selectors | Traditional colon cases can fall through |
| Java 7 | String selectors | A null string selector still throws |
| Java 14 | Switch expressions and arrow rules standardized after previews in Java 12/13 | Return a value; arrow rules do not implicitly fall through; blocks can `yield` |
| Java 16 | `instanceof` type patterns standardized | Avoid repeating a checked cast |
| Java 21 | Pattern matching for switch and record patterns standardized | Match reference types, deconstruct records and handle null explicitly |

Java 21 does **not** make traditional primitive `long`, `float`, `double` or `boolean` selectors generally legal. Reference-type pattern switches broaden the old selector rules; do not memorize the Java 7 selector list as the complete modern rule.

```java
record RetryRequest(int attempts) { }

class PatternDecision {
    static String describe(Object value) {
        return switch (value) {
            case null -> "missing";
            case RetryRequest(int attempts) when attempts > 0 ->
                    "retry " + attempts;
            case RetryRequest(int attempts) -> "no retry";
            case String text -> text;
            default -> "unsupported";
        };
    }
}
```

The record pattern extracts `attempts`, and `when` adds a guard. A broad earlier pattern can dominate a narrower later one, making that later label a compile-time error. `default` does not implicitly catch null: the explicit `case null` above supplies that policy.

Switch expressions must be exhaustive. For closed enum/sealed alternatives, omitting a redundant default can help the compiler flag newly added cases when recompiling. A separately evolved runtime hierarchy can still cause a match failure; exhaustiveness is not a deployment-version compatibility strategy.

**Interview follow-up:** "Would you replace every `if` with a pattern switch?" No. Use it when alternatives form a clear classification; keep simple predicates simple, and avoid hiding expensive or state-changing work in guards.

## 13. Exceptions and resource cleanup

This topic has moved to the companion guide: [Exceptions, Generics, I/O and Serialization](Java-Exceptions-Generics-IO-Serialization.md). Use that guide for the full explanations and examples.

## 14. Lambdas, streams and Optional

This topic has moved to the companion guide: [Java 8: Lambdas, Streams, Optional and Date/Time](Java-8-Lambdas-Streams-Optional.md). Use that guide for the full explanations and examples, including method references, checked exceptions in lambdas, the three `reduce()` flavors and parallel-stream guidance.

## 15. I/O, NIO.2, charsets and network boundaries

This topic has moved to the companion guide: [Exceptions, Generics, I/O and Serialization](Java-Exceptions-Generics-IO-Serialization.md). Use that guide for the full explanations and examples.

## 16. Serialization: legacy mechanism, explicit trust boundary

This topic has moved to the companion guide: [Exceptions, Generics, I/O and Serialization](Java-Exceptions-Generics-IO-Serialization.md). Use that guide for the full explanations and examples.

## 17. Annotations, reflection and runtime processing

### Metadata does not execute itself

Java 5 introduced annotations. Java 6 standardized annotation processing APIs; Java 8 added repeatable and type-use annotations. Java 9 modules changed the accessibility environment; Java 17 strong JDK encapsulation makes reliance on unsupported reflective internals particularly brittle.

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Audited {
    String action();
}

class AnnotatedService {
    @Audited(action = "export")
    void export() { }
}
```

This declares runtime-readable metadata. It does not write an audit event. A processor, reflection-based framework or generated/proxied/intercepted code must interpret it. This is the same distinction that matters when discussing Spring annotations: the annotation is not itself the transaction/security implementation.

| Meta-annotation | Meaning | Practical trap |
| --- | --- | --- |
| `@Retention(SOURCE)` | Not retained in the class file | Runtime reflection cannot discover it |
| `@Retention(CLASS)` | Class-file retention; the default if retention is omitted | Not generally available through runtime reflection |
| `@Retention(RUNTIME)` | Retained for reflective use | Still needs a consumer to perform behavior |
| `@Target` | Restricts permitted declaration/type-use locations | Omitting it does not grant arbitrary type-use applicability |
| `@Inherited` | Class-annotation lookup can inherit from superclass declarations | Not automatic inheritance from interfaces or overridden methods |
| `@Documented` | Includes annotation use in generated API documentation | Does not enforce a runtime rule |

Annotation elements take restricted types: primitives, `String`, `Class`, enum types, annotation types and single-dimensional arrays of allowed element types. No arbitrary object-valued elements, parameters, throws clauses or null defaults.

### Foundation: annotation declaration, usage and consumer are different

`@interface Audited` declares an annotation type, `@Audited(action = "export")` attaches metadata, and a processor/framework reads it. Its elements look like no-argument methods, but using the annotation supplies metadata values rather than invoking a service method.

`String action() default "read";` makes that element optional at usage; without a default it must be supplied. A marker annotation has no elements: its presence is the whole signal. `@Documented` controls generated documentation, not retention. `@Inherited` concerns lookup on class inheritance, not automatically copying annotations onto methods/interfaces.

Default retention is CLASS, not RUNTIME. A missing `@Target` permits declaration contexts except type-parameter declarations; it does not mean arbitrary type-use locations. To annotate a type use such as a generic argument, choose the appropriate `TYPE_USE` target explicitly. This refines the source's Java 5-era "any program element" shortcut.

`@Override` lets the compiler catch mistaken overriding; Java 6 permits it for interface implementations, unlike Java 5's earlier restriction. `@SuppressWarnings` only suppresses diagnostics. Java 8's `@FunctionalInterface` checks a functional-interface declaration. Java 9 enhanced `@Deprecated` with `since` and `forRemoval`.

### Reflection should respect contracts

Reflection can inspect fields/methods and invoke constructors/methods subject to access/module rules. It is not a promise that `setAccessible(true)` can bypass every boundary on Java 21. A reflective invocation can wrap the target exception in `InvocationTargetException`; inspect the cause rather than reporting only the wrapper.

**Interview follow-up:** "Why does my custom annotation do nothing?" Check its target, retention, whether a processor/interceptor actually reads it, and whether invocation crosses that mechanism's boundary. Do not assume adding `RUNTIME` implements the missing consumer.

## 18. JDBC beneath modern data-access frameworks

Most modern Java applications do not hand-manage `Connection`, `PreparedStatement` and `ResultSet` in every service. They use JPA/Hibernate, Spring Data, `JdbcTemplate`, jOOQ or another data-access layer. For relational databases, these abstractions commonly still use JDBC drivers underneath; the framework reduces repetitive plumbing, but it does not remove SQL, connection-pool limits, database transaction semantics or query costs.

### The parts worth knowing at senior level

- **Connection ownership:** a `DataSource` is the standard connection-acquisition abstraction and is commonly backed by a pool. Closing a borrowed connection usually returns it to the pool. Release it promptly; do not hold a transaction/connection across slow HTTP calls or other unrelated work.
- **SQL boundaries:** parameterized queries bind values, not table names, column names or sort keywords. Use parameters for values and allowlists for dynamic SQL structure. An ORM does not make unsafe native SQL safe.
- **Transaction boundaries:** a local JDBC transaction belongs to a connection. Framework transaction management coordinates connection use for participating operations; an annotation by itself does not make unrelated databases or remote services part of one atomic transaction. ORM flush sends pending SQL but is not the same as commit.
- **Batching and atomicity:** batching may reduce round trips, but it is not what makes a group of writes atomic. Atomicity depends on the transaction boundary and database support. A failure during commit can leave the client unsure whether the database committed, so blind retries need idempotency or reconciliation.
- **Capacity and latency:** pool size is a limit on concurrent database connections, not a target for application-thread count. More waiting workers do not add database capacity. Diagnose pool wait time, active/idle connections, query latency and transaction duration before increasing limits.

### A small JDBC example: the mechanics frameworks normally own

```java
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;

class ReportRepository {
    static int countOpenReports(DataSource dataSource, String owner)
            throws SQLException {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "select count(*) from report where owner = ? and status = ?")) {
            statement.setString(1, owner);
            statement.setString(2, "OPEN");
            try (ResultSet rows = statement.executeQuery()) {
                rows.next();
                return rows.getInt(1);
            }
        }
    }
}
```

The placeholders bind values; the cursor starts before the first row, so `next()` advances it before a column read. Each nested resource is closed automatically. In a pooled setup, closing the connection generally returns it to the pool. The example assumes the query returns one row and a compatible schema; production code normally lets its data-access framework map rows and coordinate the connection.

### Practical scenario: an import service stalls under load

Suppose a service processes each uploaded record by writing it, then calls a remote validation API before moving to the next record. If the database transaction remains open during each remote call, it holds a connection—and possibly locks—while waiting on another service. A pool of 20 connections can then saturate even when application workers are available. Separate the remote validation phase from the short database transaction where consistency requirements permit, measure pool wait and transaction duration, and use bounded admission rather than assuming a larger thread pool will fix database throughput.

For an interview, explain which operations must commit together, how the framework binds its transaction to database work, and what happens if the process fails after the database commits but before the client receives confirmation. Driver categories, JDBC-ODBC history, scrollable cursors and disconnected `RowSet` variants are useful only when a specific legacy system or role calls for them; they are not core modern-application revision topics.

## 19. Threads, synchronization and the Java Memory Model

**Deferred:** retained material; revise and study in the dedicated multithreading document, not this pass.

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

Platform threads are typically scheduled by the OS; the old claim that the JVM schedules them independently of the OS is too broad. Virtual threads introduce an additional runtime scheduling layer, covered after these fundamentals in section 20.

### Start with the problem: atomicity, visibility and ordering differ

The Java Memory Model was revised in Java 5. The resulting happens-before rules still underpin Java 21; virtual threads do not replace them.

| Requirement | Example failure | Suitable mechanism |
| --- | --- | --- |
| Visibility | Worker does not observe an updated stop flag reliably | A volatile flag, lock or higher-level coordination with the required memory effects |
| Atomicity | Two increments overwrite one another | Atomic update or one lock covering the entire read-modify-write |
| Multi-field invariant | Balance and reservation state disagree | One coherent locking/transactional protocol, not independent volatile fields |
| Ordering/publication | Consumer observes a reference without guaranteed initialized state | Safe publication through locks, volatile, concurrent structures or other specified happens-before edges |

### Volatile: more than a "main-memory copy", less than a lock

The source's claim that volatile is instance-only is incorrect: **static volatile fields are legal too**. A volatile write happens-before subsequent reads of that field under the memory model; this provides visibility/ordering guarantees. It is not best understood as forcing every access to fetch from physical RAM.

`volatile int count; count++;` is not an atomic increment. A volatile reference makes reference updates visible, not all subsequent unsynchronized mutations of the object thread-safe. Non-volatile `long`/`double` reads/writes may be non-atomic under the specification; do not rely on a particular 64-bit implementation to provide a stronger portable contract.

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

This makes each operation meaningful independently; it does not promise that stopping and the count form one atomic snapshot. `LongAdder` (Java 8) can improve highly contended statistical counters, but its sum is not an atomic snapshot suitable for every balance/limit decision.

### Synchronized protects a lock protocol, not an entire object automatically

An instance synchronized method locks `this`; a static synchronized method locks that class's `Class` object. They are different locks. A synchronized block locks its specified object. Two synchronized methods using the same lock exclude each other; unsynchronized code does not become protected merely because some methods synchronize.

Monitor locks are reentrant: a thread can reacquire a lock it already holds. Unlocking a monitor happens-before a subsequent lock of that same monitor. Every read/write participating in the protected invariant must obey the same protocol.

**Scenario:** all writes synchronize, but an unsynchronized getter still returns stale state. The missing read-side synchronization/visibility is the defect. Adding `synchronized` to an unrelated method or locking a different object does not repair it.

Proper construction and final-field rules support immutable objects, but do not publish `this` before construction completes. For mutable objects, use a clear safe-publication mechanism, such as a volatile reference or concurrent collection, and a protocol for later mutations.

**Lock-object recall:** `synchronized (lock)` coordinates only with other code acquiring that **same object**. Two different account instances do not exclude each other through their separate synchronized instance methods. Static synchronized methods share the Class object's monitor instead. A lock is released when the protected block exits, including by exception; calling sleep inside it does not release it.

### Thread lifecycle: API states versus scheduling diagrams

Calling `run()` directly is an ordinary call on the current thread. `start()` schedules a new thread that will execute `run()`. A thread can be started only once; repeated start throws `IllegalThreadStateException`. Multiple threads can run the same `Runnable`, which means its mutable state may be shared.

Java's `Thread.State` values are `NEW`, `RUNNABLE`, `BLOCKED`, `WAITING`, `TIMED_WAITING`, `TERMINATED`. There is no separate API enum state called `RUNNING`: RUNNABLE covers runnable/executing states. `BLOCKED` specifically concerns waiting to acquire a monitor; not every blocked I/O or lock operation appears as that state.

Thread priorities, start order, `sleep` and `yield` do not establish fairness or reliable execution order. The source's claim that sleep guarantees turn-taking was **never a valid guarantee**.

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

### Deadlock, starvation and livelock

Deadlock: thread A holds lock 1 and waits for lock 2 while thread B holds lock 2 and waits for lock 1. Prevent with consistent lock ordering, smaller lock scope and avoiding external calls while holding locks; timed `tryLock` can support a deliberate failure/retry policy.

Starvation: a thread cannot obtain needed progress/resources. Livelock: threads keep taking actions but make no useful progress, such as mutually conflicting immediate retries. Sleep-based guesses are not a proof of correctness.

`ReentrantLock` supports explicit lock/unlock, timed/interruptible acquisition and conditions. Unlock in `finally` **after successful acquisition**. A fair-lock setting can affect lock acquisition ordering/throughput; it does not guarantee end-to-end scheduler fairness. Use an actual lock requirement to justify it.

## 20. Executors, futures and Java 21 virtual threads

**Deferred:** part of the future multithreading document; no concurrency expansion is included in this revision.

### Foundation: submit tasks to workers instead of starting tasks as threads

A pool contains worker **threads**, which execute submitted **tasks**. Completing a task does not normally destroy the worker; it can execute another task. A queued Runnable is not already a running thread. This is the distinction behind the source's high-level concurrency objects.

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

### Pool sizing and backpressure

A fixed thread count is not the same as a bounded system. `Executors.newFixedThreadPool` uses an unbounded queue; `newCachedThreadPool` can create many threads. Both can overload a service under sustained demand.

For platform-thread work, consider an explicitly configured `ThreadPoolExecutor` with measured worker limits, a bounded queue and a deliberate rejection policy. CPU-heavy work is constrained by available CPU; I/O-heavy work also needs limits based on downstream capacity, memory and latency goals.

**Failure scenario:** every worker submits a child task to the same exhausted pool and blocks waiting for it. No worker remains to run the children. Avoid this dependency structure or use suitable non-blocking composition/separate execution policies; merely raising the pool size can postpone the next deadlock.

Scheduled executors replace ad hoc sleeping timer threads. Fixed-rate and fixed-delay scheduling have different timing semantics; an uncaught task exception can suppress later periodic executions. Surface that failure rather than assume the schedule is still healthy.

### CompletableFuture: composition, not hidden error recovery

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

`thenApply` transforms a result; `thenCompose` flattens a callback returning another stage. Non-async callbacks may run on a completion/calling thread; async variants use the specified executor or default async facility. Do not accidentally put blocking I/O on the common pool.

`join()` propagates failures through unchecked `CompletionException`; `get()` uses checked `ExecutionException`/`InterruptedException`. Java 9 added timeout helpers such as `orTimeout`; completing a future exceptionally on timeout does not guarantee the underlying network request stops. `CompletableFuture.cancel(true)` itself does not interrupt the underlying computation like an ordinary interruptible task future might.

### Virtual threads: more concurrency, not faster CPU

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

**Scope matters:** separate calls each create a separate semaphore, so this is not a service-wide or distributed limit. For a service-wide dependency budget, share the limiter at the appropriate lifecycle scope. The example also submits the whole input, so it is suitable only for bounded input; use admission control/windowed submission for an unbounded workload. Ordered `get()` is not fail-fast discovery of every later task's error.

### Java 21-specific caveats to mention in an interview

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

**Preview boundary:** structured concurrency and scoped values are preview features in Java 21. They can be discussed as emerging tools, but are not stable APIs assumed by this guide and require explicit preview opt-in. Likewise, Java 21 string templates and unnamed patterns/variables are previews, not ordinary production-baseline syntax.

## 21. Version recall and practical upgrade decisions

### Foundation checkpoints before memorizing release numbers

Use these as spoken-answer checks, not coding assignments. If an answer feels like a slogan, return to its example and trace the mechanism.

| Topic | Question to answer | Reasoning anchor |
| --- | --- | --- |
| Interfaces / abstract classes | Why does an abstract class need a constructor, but an interface has none? | One concrete object includes initialized superclass state; the interface has no per-instance state |
| Access / encapsulation | Why can Child read a protected field through a Child receiver but not an arbitrary Parent receiver across packages? | Access is governed by both the declaring relationship and receiver restrictions, not a modifier changing to private |
| Variables / arguments | Why does mutating a parameter's object affect the caller, but replacing the parameter does not? | The reference value was copied; both copies initially reach one object |
| Dispatch | Why does an Object-typed String argument select the Object overload? | Compile-time types select the signature before runtime receiver dispatch |
| Construction | Why can a child override see null during a parent constructor? | Dispatch is already virtual, but child field initializers have not run yet |
| Nested types | Why is `outer.new Inner()` different from `new Outer.Nested()`? | The former needs an enclosing instance; the latter has no implicit one |
| Enums / records | Why is an enum not simply a record with named values? | Enum declarations fix the actual instances; record constructors create values from caller-supplied data |
| Immutability / equality | Why are private final fields and no setters insufficient? | Mutable aliases can escape; identity and domain-value equality are separate choices |
| Strings | Why did calling a String operation appear to do nothing? | The result was ignored; the original immutable value was not mutated |
| Arrays / flow | Why can Object[] backed by String[] reject an Integer? | Runtime component type still enforces the array's actual storage contract |
| Exceptions | Why can finally change a returned object's contents but not a previously evaluated int result? | The return expression is evaluated before cleanup; copied references still reach the same mutable object |
| Lambdas | Where does an untyped lambda parameter get its type? | The target functional interface supplies the operation's signature |
| I/O | Why wrap a file stream with buffering and then a data stream? | Byte source, batching and typed interpretation are separate responsibilities |
| Serialization | Why must a transient collaborator be reconstructed explicitly? | Default restoration excludes it and ordinary Serializable construction is bypassed |
| Annotations | Why does adding an annotation not automatically perform its named action? | Metadata requires a processor, interceptor or other consumer |
| JDBC | Why does executeBatch not make several updates atomic? | Submission strategy and connection-owned transaction boundaries are distinct |

**Coverage boundary:** generics, exceptions, I/O and serialization are developed in the [companion guide](Java-Exceptions-Generics-IO-Serialization.md). Collections and multithreading remain deferred to their own documents; preserved legacy material and release milestones are not requirements for this pass.

### The memory thread from the old notes to Java 21

| Release | Interview-relevant milestones in this guide |
| --- | --- |
| Java 5 | Generics, enums, annotations, boxing, varargs, enhanced-for, concurrency utilities and revised memory model |
| Java 6 | JDBC 4 driver discovery; standardized annotation processing; `@Override` on interface implementations |
| Java 7 | Diamond, binary/underscored literals, string switch, multi-catch, try-with-resources, NIO.2 and fork/join |
| Java 8 | Lambdas, streams, Optional, default/static interface methods, java.time, CompletableFuture |
| Java 9 | Modules, private interface helpers, collection factories, resource-variable syntax, deserialization filtering |
| Java 10 | Local `var`, collection `copyOf` factories |
| Java 11 | Standard HTTP client, useful String/Files APIs, `var` in lambda parameters |
| Java 14 | Standard switch expressions |
| Java 15 | Standard text blocks |
| Java 16 | Standard records and instanceof patterns; relaxed static-member restrictions for inner classes |
| Java 17 | Standard sealed types, always-strict floating point, strong JDK encapsulation and context-specific serialization filters |
| Java 18 | UTF-8 default charset for most APIs; finalization deprecated for removal |
| Java 19 | ExecutorService close support; virtual threads still preview here |
| Java 21 | Standard virtual threads, record patterns, pattern switch and sequenced collections |

This is a map of concepts covered here, not a claim that releases omitted from the table had no changes. Java 12/13 switch-expression previews, for example, explain the later Java 14 standard feature. Distinguish **first preview** from **standard release**, and language/API contracts from HotSpot implementation details.

### "How would you move a Java 7 service to Java 21?"

Start with a supported runtime, build plugins, dependencies, framework and JDBC driver. Establish existing behavior before rewriting syntax. Inventory removed/internal APIs, reflection, charsets, serialization and concurrency assumptions; upgrading the JVM does not require adopting every new feature at once.

`javac --release 21` checks against the Java 21 language/API baseline without enabling previews. When an older runtime must remain supported, choose its actual supported release target instead; a Java 21 API cannot be made available on Java 8 by changing only syntax. Dependencies also need compatible bytecode and runtime requirements.

Use `jdeps` to investigate dependencies/JDK internals and `jdeprscan` for deprecated JDK usage, recognizing their limits with reflection and dynamic loading. Run behavior-focused tests against the intended runtime/database and observe startup, memory, GC, latency and external-resource usage under realistic load.

| Symptom after an upgrade/change | Reasoning path, not a memorized fix |
| --- | --- |
| Reflective access fails | Identify unsupported internals/module access and library compatibility; don't blanket-open the JDK |
| A list that used to accept `add` now throws | Check whether a refactor introduced `List.of`, `copyOf` or `Stream.toList` and whether callers require mutability |
| Text files change behavior | Compare explicit/default charsets, malformed-input handling and line-ending expectations |
| A request counter loses updates | Check atomicity and shared-state scope, not the Java version's thread speed |
| Virtual threads increased load but not throughput | Inspect DB/HTTP limits, CPU saturation, pinned carriers and admitted work |
| Serialization rejects saved objects | Check version/schema compatibility and filter policy; don't disable filters to make unknown data load |
| A map lookup fails intermittently | Inspect equality/hash consistency and mutable keys before blaming the hash implementation |
| DB rows partially commit despite batching | Inspect auto-commit/transaction ownership, driver failure behavior and commit uncertainty |

**Interview closing answer:** "I retain the old rules that still hold, replace inaccurate claims rather than calling them historical guarantees, and adopt newer features where they simplify a concrete problem. Java 21 improves modelling and concurrency, but invariants, resource ownership, failure semantics and measured capacity still determine correctness."
