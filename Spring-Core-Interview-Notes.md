# Spring Core: Interview Notes (refreshed for 2026)

> Based on the attached four-page PDF, dated May 21, 2018. The original covers useful foundations, but mixes in outdated APIs, legacy XML examples, and a few misleading simplifications. This version preserves its core topics, corrects those points, and adds high-value gaps. It is a study guide, not a claim that every job uses Spring Framework 7.

Reviewed: October 31, 2026. This is an editorial conversion, not a verbatim transcript.

Companion guides: [Boot](Spring-Boot-Interview-Notes.md), [REST + MVC](Spring-REST-MVC-Interview-Notes.md), [Data](Spring-Data-Interview-Notes.md), [Security](Spring-Security-Interview-Notes.md).

## How relevant are the original notes?

| Topic from the PDF | 2026 interview value | Update |
|---|---:|---|
| IoC, dependency injection, constructor vs. setter injection | High | Still foundational; explain trade-offs and dependency resolution. |
| Bean scopes and singleton thread safety | High | Keep, but clarify singleton is per container and is not inherently thread-safe. |
| `BeanFactory` vs. `ApplicationContext` | Medium | Know the distinction; old blanket claims about annotation support are inaccurate. |
| Stereotypes and component scanning | Medium-high | Keep the intent; use modern Java configuration examples rather than XML as the default. |
| Bean lifecycle | High | Keep, but add factory/post-processors, destruction, and where proxies are created. |
| AOP and proxy types | High | Keep; add self-invocation and proxy limitations, which are frequent interview traps. |
| Profiles and lazy initialization | Medium | Keep; distinguish profiles from conditional bean registration and understand when laziness applies. |
| Inner beans, XML autowiring modes, MVC flow, design-pattern lists | Low for Core | Recognize the concepts, but prioritize practical behavior over memorized lists. MVC belongs in the MVC study file. |

## 1. IoC, dependency injection, and configuration

- **Inversion of Control (IoC)** means a framework/container controls object creation and wiring rather than application code assembling every dependency itself.
- **Dependency Injection (DI)** is one way to implement IoC: an object receives its collaborators rather than locating or constructing them. Constructor injection makes required dependencies explicit and supports immutable, fully initialized objects.
- Prefer **constructor injection for required dependencies**. Use setter or method injection when a dependency is genuinely optional or must be reconfigured. A constructor with many unrelated dependencies can indicate that the class has too many responsibilities.
- Common configuration styles are Java configuration (`@Configuration`, `@Bean`), component scanning (`@Component`, `@Service`, etc.), and XML. XML remains supported; it is simply not the default style in most modern applications.
- `@Configuration(proxyBeanMethods = false)` avoids CGLIB interception of calls between `@Bean` methods. In that mode, do not call one `@Bean` method from another expecting the container to return the managed singleton; express the dependency as a method parameter instead.

### Why constructor injection, and what if there are multiple constructors?

Constructor injection is usually preferred for required dependencies because the object cannot be constructed without them, the dependencies are visible in its API, and fields can be `final`. It also makes unit testing straightforward: construct the object with a fake or mock dependency without starting Spring.

```java
@Service
class CheckoutService {
    private final PaymentGateway gateway;

    CheckoutService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

Spring automatically uses this sole constructor; `@Autowired` is unnecessary. With field injection, by contrast, `new CheckoutService()` could produce an object whose injected fields are still unset. Constructor injection ensures dependencies are supplied, though explicit validation is still needed if callers outside Spring must be prevented from passing `null`.

Setter injection can be appropriate for a genuinely optional dependency with sensible behavior when absent, a dependency intentionally replaceable after construction, or a framework/library object that must be constructed first and configured later:

```java
@Component
class ReportExporter {
    private AuditSink auditSink;

    @Autowired(required = false)
    public void setAuditSink(AuditSink auditSink) {
        this.auditSink = auditSink;
    }

    public void export(Report report) {
        // Export the report...
        if (auditSink != null) {
            auditSink.record(report);
        }
    }
}
```

If no `AuditSink` bean exists, Spring skips this setter. Multiple ambiguous candidates still need disambiguation; `required = false` does not mean "ignore all wiring errors." An optional constructor parameter such as `Optional<AuditSink>` is also valid, so optionality does not force setter injection. Do not switch to setter injection merely to hide a circular dependency.

**Multiple constructors:** explicitly mark the constructor Spring should use with `@Autowired`:

```java
@Service
class NotificationService {
    private final MessageSender sender;
    private final int maxAttempts;

    @Autowired
    NotificationService(MessageSender sender) {
        this(sender, 3);
    }

    NotificationService(MessageSender sender, int maxAttempts) {
        this.sender = sender;
        this.maxAttempts = maxAttempts;
    }
}
```

Spring uses the annotated constructor and injects `MessageSender`; application code or tests can use the two-argument constructor for explicit settings. Spring does not automatically treat the `int` in an unannotated constructor as a configuration property.

| Constructor arrangement | Spring behavior for ordinary annotation-driven creation |
| --- | --- |
| Exactly one constructor | Uses it without requiring `@Autowired`. |
| Multiple constructors, one marked `@Autowired` (default `required = true`) | Uses that constructor; missing required dependencies fail bean creation. |
| Multiple constructors, none annotated, with a no-argument constructor | Normally uses the no-argument constructor; it does not simply choose the largest constructor. |
| Multiple constructors, none annotated, no no-argument constructor | Ordinary bean creation fails without another explicit construction mechanism. |
| Multiple constructors marked `@Autowired(required = false)` | Considers those candidates and selects the greediest satisfiable one; a default constructor can serve as a fallback. Avoid equally satisfiable ambiguous overloads. |

Only one constructor may be marked with the default required `@Autowired`; do not annotate multiple constructors as required. Explicit `@Bean` construction is another option: `return new NotificationService(sender, 5)` selects the constructor through normal Java code rather than annotation-driven constructor selection.

### Java configuration vs. component scanning

**Java configuration** explicitly registers objects through `@Bean` methods. Use it when you need control over construction, including classes from libraries that you cannot annotate. This plain Spring example does not require Spring Boot:

```java
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

class GreetingService {
    private final String greeting;

    GreetingService(String greeting) {
        this.greeting = greeting;
    }

    String greet(String name) {
        return greeting + ", " + name;
    }
}

@Configuration(proxyBeanMethods = false)
class GreetingConfig {
    @Bean
    GreetingService greetingService() {
        return new GreetingService("Hello");
    }
}

class JavaConfigDemo {
    public static void main(String[] args) {
        try (var context =
                new AnnotationConfigApplicationContext(GreetingConfig.class)) {
            System.out.println(context.getBean(GreetingService.class).greet("Sam"));
        }
    }
}
```

Output: `Hello, Sam`. Spring manages the object returned by `greetingService()`; the method name is its default bean name. Calling `new GreetingService(...)` elsewhere does not register that object with Spring.

**Component scanning** discovers annotated classes in the selected packages and registers bean definitions for them. Here are three separate files in the `example.scanning` package:

```java
// GreetingService.java
package example.scanning;

import org.springframework.stereotype.Service;

@Service
public class GreetingService {
    public String greet(String name) {
        return "Hello, " + name;
    }
}
```

```java
// ScanningConfig.java
package example.scanning;

import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ComponentScan(basePackageClasses = GreetingService.class)
public class ScanningConfig { }
```

```java
// ScanningDemo.java
package example.scanning;

import org.springframework.context.annotation.AnnotationConfigApplicationContext;

public class ScanningDemo {
    public static void main(String[] args) {
        try (var context =
                new AnnotationConfigApplicationContext(ScanningConfig.class)) {
            System.out.println(context.getBean(GreetingService.class).greet("Sam"));
        }
    }
}
```

Output is again `Hello, Sam`. `basePackageClasses` selects the package containing that class and its subpackages without a fragile package-name string. `@Service` alone is not enough: the class must be scanned or explicitly registered. In Boot, `@SpringBootApplication` normally enables scanning from its own package downward.

These styles can be combined: scan application services and use `@Bean` for library clients or explicit construction. Avoid registering the same intended service both ways accidentally. The two `GreetingService` examples above are alternatives, not classes to combine into one sample.

### Calls between `@Bean` methods

For example, with `proxyBeanMethods = false`, this call to `repository()` is an ordinary Java method call. It creates a second `Repository` rather than retrieving the bean registered by Spring:

```java
@Configuration(proxyBeanMethods = false)
class AppConfig {
    @Bean
    Repository repository() {
        return new Repository();
    }

    @Bean
    Service service() {
        return new Service(repository()); // A new Repository, not the managed bean
    }
}
```

Declare the dependency as a `@Bean` method parameter instead. Spring resolves the parameter and supplies the managed `Repository` bean:

```java
@Configuration(proxyBeanMethods = false)
class AppConfig {
    @Bean
    Repository repository() {
        return new Repository();
    }

    @Bean
    Service service(Repository repository) {
        return new Service(repository);
    }
}
```

With the default `proxyBeanMethods = true`, Spring proxies calls between `@Bean` methods so a direct call such as `repository()` is intercepted and returns the managed bean. Method-parameter injection is still a clear way to express the dependency and does not rely on that proxy behavior.

### Dependency resolution

Spring first looks for beans matching the dependency's type. If there is exactly one match, it injects that bean. If several beans match, Spring needs a way to choose: `@Primary` marks the default candidate, while `@Qualifier` narrows the choice to a specifically named or labeled candidate. A field or constructor parameter name can also help disambiguate in supported configurations, but an explicit qualifier makes the intent clearer.

For example, suppose an application has two `PaymentGateway` beans:

```java
@Component
@Primary
class StripeGateway implements PaymentGateway { }

@Component("paypalGateway")
class PayPalGateway implements PaymentGateway { }
```

An unqualified dependency gets the primary bean; a qualified dependency asks for PayPal:

```java
@Service
class CheckoutService {
    CheckoutService(PaymentGateway gateway) {
        // Receives StripeGateway because it is @Primary.
    }
}

@Service
class PayPalCheckoutService {
    PayPalCheckoutService(
            @Qualifier("paypalGateway") PaymentGateway gateway) {
        // Receives PayPalGateway, even though StripeGateway is primary.
    }
}
```

When the goal is to use every matching bean, inject a collection instead. Spring can inject a `List<PaymentGateway>` or a `Map<String, PaymentGateway>` (keyed by bean name). `@Order` can control the order of beans in an ordered collection; it does not select the winner for a single `PaymentGateway` dependency.

### Providers: an injected handle for looking up a bean

A **provider** is an object Spring injects that lets you ask for a dependency later. Instead of receiving `T` directly, you receive `ObjectProvider<T>` or `jakarta.inject.Provider<T>`. Think of it as "give me the appropriate bean when I ask," not as the bean itself or a factory that always constructs a new object.

```java
// Direct injection: receive the dependency during construction.
ReportService(ReportFormatter formatter)

// Provider injection: receive a lookup handle during construction.
ReportService(ObjectProvider<ReportFormatter> formatterProvider)
```

These are alternative constructor signatures. With the provider, call `formatterProvider.getObject()` inside the operation that needs the formatter. Spring resolves the dependency at that point using its candidate-selection and scope rules.

| Dependency form | How it is used |
| --- | --- |
| `T` | Use the injected dependency directly; it may itself be a scoped or lazy proxy. |
| `Optional<T>` | Check whether a dependency was available when injection was resolved; not a repeatable lookup handle. |
| `ObjectProvider<T>` | Spring API: `getObject()` for required lookup, `getIfAvailable()` for optional lookup, plus collection-oriented operations. |
| `jakarta.inject.Provider<T>` | Standard Jakarta API: `get()` for required lookup; needs the Jakarta Inject API on the classpath. |

`getObject()` and `get()` fail if no suitable bean is available. `getIfAvailable()` returns `null` when no matching bean exists, but still throws for unresolved ambiguity or bean-creation failures. Providers do not bypass `@Qualifier` / `@Primary` or silently ignore wiring errors.

#### Optional lookup sample

For a dependency that may not exist, use `Optional<T>` when a simple optional value is enough. Use a provider when lookup should be deferred or repeated. For example, an audit sink can be looked up only when an order is placed, rather than required when `OrderService` is constructed:

```java
@Service
class OrderService {
    private final ObjectProvider<AuditSink> auditSinkProvider;

    OrderService(ObjectProvider<AuditSink> auditSinkProvider) {
        this.auditSinkProvider = auditSinkProvider;
    }

    void placeOrder(Order order) {
        // Save the order...
        AuditSink auditSink = auditSinkProvider.getIfAvailable();
        if (auditSink != null) {
            auditSink.record(order);
        }
    }
}
```

Import `org.springframework.beans.factory.ObjectProvider` for this example.

`ObjectProvider` is Spring-specific and offers methods such as `getIfAvailable()` for optional lookup. With `jakarta.inject.Provider<T>`, call `get()` at the point of use; it performs the lookup then, and expects a matching bean to be available:

```java
@Service
class ReportService {
    private final Provider<ReportFormatter> formatterProvider;

    ReportService(Provider<ReportFormatter> formatterProvider) {
        this.formatterProvider = formatterProvider;
    }

    String format(Report report) {
        return formatterProvider.get().format(report);
    }
}
```

Import `jakarta.inject.Provider` for the second example.

The provider delays *when the bean is looked up*; it does not necessarily delay creation of a non-lazy singleton, which the context can still instantiate eagerly. The bean's configured scope determines whether repeated lookups return the same instance or a new one:

| Target scope | Repeated provider lookups |
| --- | --- |
| Singleton | Return the same managed instance for that bean definition. |
| Prototype | Create a new instance on each lookup. |
| Request | Resolve the instance for the active HTTP request; reuse it within that request. |
| Session | Resolve the instance for the active HTTP session; reuse it within that session. |

With a scoped proxy enabled, the lookup can return the proxy rather than a concrete target; the proxy then resolves the target when a method is called. See the [request-scoped provider sample](#provider-alternative-for-a-request-scoped-dependency) below for explicit lookup without a scoped proxy.

Constructor injection is a common modern default; `@Autowired` is not required when a class has a sole constructor.

## 2. Container, bean definitions, and scopes

- `BeanFactory` is the foundational container API. `ApplicationContext` builds on it and adds application-level facilities such as events, message resolution, and resource loading.
- A typical `ApplicationContext` eagerly creates non-lazy singleton beans during refresh; a basic `BeanFactory` is more often used in a lazy fashion. This is a default behavior, not an absolute rule: lazy settings and bean dependencies affect when objects are instantiated.
- A **bean definition** is configuration/metadata for creating a bean; it is not the bean instance itself.
- **Singleton** means one instance per bean definition per container, not one instance for the whole JVM. It says nothing about thread safety. Stateless singleton services are a common pattern; mutable shared state needs deliberate concurrency control.
- **Prototype** creates a new instance for each request from the container. Spring does not manage the full destruction lifecycle of prototype instances after handing them to the caller.
- Web-aware contexts can provide **request** and **session** scopes. A singleton that depends on a shorter-lived bean needs an appropriate proxy or provider so it does not capture one short-lived instance forever. `globalSession` is a legacy, portal-specific scope and is rarely relevant.
- Other current web scopes include **application** (per `ServletContext`) and **websocket** (for supported WebSocket sessions). They are not the same as a singleton per Spring container.
- Inner beans are a legacy XML technique for an object used only at one injection point. Modern Java configuration usually expresses the same relationship directly.

### Web scopes and injecting a shorter-lived bean

Scope determines how long a bean instance is reused:

| Scope | Instance reused for | Example |
| --- | --- | --- |
| Singleton | One bean definition in one Spring container | A stateless checkout service |
| Request | One HTTP request | Request-specific tracking information |
| Session | One HTTP session, across multiple requests | A user's shopping cart |
| Application | One `ServletContext` | State shared across a web application |
| WebSocket | One supported WebSocket session | Conversation state for that session |

Two requests from the same HTTP session get different request-scoped objects but share a session-scoped shopping cart. A different HTTP session gets its own cart. Session scope follows the HTTP session, not the user's identity.

The lifetime mismatch arises when a singleton service needs request-specific data. The service is shared across requests, so it must not retain the actual object belonging to one request. Inject a scoped proxy instead:

```java
@Component
@RequestScope
class RequestDetails {
    private final String trackingId = java.util.UUID.randomUUID().toString();

    public String getTrackingId() {
        return trackingId;
    }
}

@Service
class TrackingService {
    private final RequestDetails requestDetails;

    TrackingService(RequestDetails requestDetails) {
        this.requestDetails = requestDetails;
    }

    public String currentTrackingId() {
        return requestDetails.getTrackingId();
    }
}
```

`@RequestScope` uses a class-based scoped proxy by default. The singleton `TrackingService` holds that proxy, not a particular request's `RequestDetails`. When `currentTrackingId()` runs during request A, the proxy delegates to A's object; during request B, it delegates to B's object. Repeated calls during A use the same object and tracking ID.

`@SessionScope` uses the same proxy pattern, but the target is reused for the current HTTP session. Alternatively, use a provider and look up the scoped bean at the point of use rather than caching the returned instance. Either approach still requires an active request/session context; a proxy or provider does not make request-scoped data accessible from an arbitrary background thread.

#### Provider alternative for a request-scoped dependency

In this alternative to the scoped-proxy example, explicitly disable the scoped proxy and inject a provider into the singleton:

```java
@Component
@RequestScope(proxyMode = ScopedProxyMode.NO)
class RequestDetails {
    private final String trackingId = java.util.UUID.randomUUID().toString();

    public String getTrackingId() {
        return trackingId;
    }
}

@Service
class TrackingService {
    private final ObjectProvider<RequestDetails> requestDetailsProvider;

    TrackingService(ObjectProvider<RequestDetails> requestDetailsProvider) {
        this.requestDetailsProvider = requestDetailsProvider;
    }

    public String currentTrackingId() {
        RequestDetails current = requestDetailsProvider.getObject();
        return current.getTrackingId();
    }
}
```

Use `org.springframework.beans.factory.ObjectProvider` and `org.springframework.context.annotation.ScopedProxyMode`. This sample replaces the earlier `RequestDetails` and `TrackingService` definitions; do not register both alternatives together.

The singleton stores the provider at startup without resolving a request object. During request A, `getObject()` returns A's object; repeated lookups during A return the same object. During request B, it returns B's different object. Calling it outside an active request fails. Keep the resolved object local to the operation: storing it in a singleton field would recreate the lifetime mismatch.

**Proxy vs. provider:** a scoped proxy makes ordinary dependency method calls route to the current target automatically; a provider makes the lookup explicit with `getObject()` or `get()`. Both bridge the lifetime mismatch, but neither removes the requirement for an active scope.

Without a proxy or provider, injecting a request-scoped bean into an eagerly created singleton normally fails at startup because no request scope is active. Even if the singleton were created during a request, retaining that request's concrete object would give later requests the wrong data.

Application scope and singleton scope often look similar in a simple web application with one Spring container. Their boundaries differ: application scope stores the bean in the `ServletContext`, while singleton scope stores it in a Spring container. Multiple Spring contexts sharing one `ServletContext` can therefore share an application-scoped bean, while each context can have its own singleton instance for the same bean definition. These scopes do not share state across separate server processes.

## 3. Stereotypes, profiles, and lazy beans

- `@Component` marks a class for component scanning. `@Service`, `@Repository`, and `@Controller` are more specific stereotypes that communicate role.
- `@Repository` can participate in persistence-exception translation when the relevant Spring infrastructure is active. It does not mean every DAO is automatically a Spring Data repository.
- `@Service` communicates service-layer intent; it does not, by itself, add transactions or other behavior.
- `@Controller` belongs to the web layer. `@RequestMapping`, `DispatcherServlet`, and view resolution are MVC topics and should be studied in the separate MVC notes.
- `@Profile` selects configuration for active profiles. It is useful for environment-specific beans, but it is not a general-purpose replacement for explicit configuration or feature flags.
- `@Lazy` on a bean definition delays its initialization until needed. `@Lazy` at an injection point can inject a lazy-resolution proxy. It does not make an unsafe object thread-safe or guarantee that startup avoids all work related to that bean.

## 4. Bean lifecycle and extension points

For a typical singleton bean, a useful simplified sequence is:

1. Spring creates the instance.
2. Spring injects dependencies and populates configured properties.
3. Relevant `Aware` callbacks run (for example, `BeanNameAware`).
4. `BeanPostProcessor` callbacks run before initialization.
5. Initialization callbacks run, such as `@PostConstruct`, `InitializingBean.afterPropertiesSet()`, and a configured `initMethod` (where applicable).
6. `BeanPostProcessor` callbacks run after initialization; infrastructure such as AOP can return a proxy here.
7. When the context shuts down, destruction callbacks such as `@PreDestroy`, `DisposableBean.destroy()`, and a configured `destroyMethod` are applied to managed beans.

The sequence is a mental model, not an exhaustive list of every specialized callback. In modern application code, prefer `@PostConstruct` / `@PreDestroy` or configured methods over implementing Spring lifecycle interfaces unless the interface is specifically useful.

Two extension points are often confused:

- **`BeanFactoryPostProcessor`** works with bean definitions/metadata before ordinary beans are instantiated.
- **`BeanPostProcessor`** works with bean instances before and after initialization; it is a key mechanism for wrapping beans with proxies.

Do not use `@PostConstruct` for expensive work that calls other beans or performs complex startup coordination. Initialization callbacks run during singleton creation; use a later lifecycle hook or context event when work must happen after singleton initialization.

## 5. AOP and proxies

Spring AOP modularizes cross-cutting behavior such as transactions, caching, and method-level security. Know the vocabulary: **aspect**, **advice**, **pointcut**, **join point**, **target**, **proxy**, and **weaving**.

- Spring AOP is proxy-based and primarily intercepts method executions invoked through the proxy.
- If a method calls another advised method on the same object via `this`, that call bypasses the proxy; advice such as transaction or retry behavior may not run on the inner call. Refactoring the boundary is usually preferable to reaching for `AopContext.currentProxy()`.
- Proxies may be interface-based (JDK dynamic proxies) or subclass-based (CGLIB). Subclass proxies cannot override final methods and cannot subclass final classes. Exact proxy selection can depend on configuration and framework integration.
- Private methods and self-invocations are not intercepted as ordinary proxy calls. Be prepared to explain why an annotation-driven behavior can appear to “not work.”
- `@Aspect` uses AspectJ-style syntax, but Spring AOP is not the same as compile-time or load-time AspectJ weaving.

## 6. Corrections to specific claims in the PDF

- **`@Required`**: The old setter annotation is no longer a modern recommendation and was deprecated and removed from the framework. Use constructor injection for required dependencies.
- **“`ApplicationContext` supports annotation DI but `BeanFactory` does not”**: Too broad. Annotation-driven injection requires the relevant post-processors to be registered; standard application contexts provide common infrastructure, while a bare factory may need explicit setup.
- **“`@Autowired` defaults to by-type”**: Misleading. Spring resolves candidates by type and then applies disambiguation rules; do not memorize this as a separate autowiring mode.
- **Five XML autowiring modes (`no`, `byName`, `byType`, `constructor`, `autodetect`)**: This is legacy configuration trivia. `autodetect` is not a current mode to rely on.
- **`@Repository` exception translation**: It depends on the relevant exception-translation infrastructure; the stereotype alone is not magic.
- **“Singleton beans are not thread-safe”**: Better: Spring singleton scope does not provide thread safety. The bean's state and synchronization strategy determine whether concurrent use is safe.
- **`globalSession`**: Historical and niche; focus on singleton, prototype, request, and session scopes.
- **“Avoid autowiring as much as possible”**: Overgeneralized advice. Prefer explicit constructor dependencies; normal constructor injection and component scanning are standard. Avoid hidden service-locator patterns and ambiguous wiring, not DI itself.
- **“Annotations are bad for large applications; use all XML”**: Not a general best practice. Choose clear, consistent configuration; modern Spring applications commonly combine Java configuration and component scanning.
- **MVC request flow and `@RequestMapping`**: Valid concepts, but out of scope for a Core revision. Keep their detailed treatment in the MVC document.
- **Historical context**: The source was assembled from older material and contains XML-era and pre-Jakarta assumptions. Verify package names and API status against the framework generation used by the target role.

### Change references: original claim -> correction -> evidence

**Version change** identifies changed APIs/defaults; **correction** identifies an inaccurate or incomplete original claim; **guidance** identifies a study/design recommendation rather than an API removal. PDF page numbers refer to the attached original, not Markdown line numbers. References were checked during the October 31, 2026 review; current documentation may subsequently advance.

| Original location / claim | Category and correction | Official evidence |
|---|---|---|
| p. 1: use `@Required` for required setters | Version change: deprecated since Framework 5.1 in favor of constructor injection; do not use the old annotation as a modern recipe. | [Archived Required Javadoc, including deprecation version](https://docs.spring.io/spring-framework/docs/5.3.39/javadoc-api/org/springframework/beans/factory/annotation/Required.html) |
| p. 1: BeanFactory cannot support annotation injection | Correction: the relevant annotation post-processors must be registered; basic factory versus context defaults are not the same as capability. | [BeanFactory versus ApplicationContext](https://docs.spring.io/spring-framework/reference/core/beans/beanfactory.html) |
| pp. 1-2: eager initialization of all configured beans | Correction: non-lazy singleton defaults, dependency requirements and injection-point proxies matter. | [Lazy-initialized beans](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-lazy-init.html) |
| pp. 1-2: singleton thread safety / old scope list | Correction and current coverage: scope is per container and bean, not a concurrency guarantee; application/websocket belong in the current scope list. | [Bean scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html) |
| p. 2: service lookup included in DI | Correction: a consumer looking up its collaborator is service location, unlike injection of that collaborator. | [Dependency injection](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html) |
| p. 2: lifecycle sequence | Correction/addition: use the correct post-processor names and distinguish initialization, post-processing and destruction. | [Lifecycle callbacks](https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html) and [extension points](https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html) |
| p. 3: avoid autowiring; prefer XML for all large apps | Guidance, not an XML removal: constructor injection and Java configuration are normal supported approaches. | [DI](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html) and [Java configuration](https://docs.spring.io/spring-framework/reference/core/beans/java.html) |
| p. 3: by-type shorthand and XML mode list | Correction/current usage: understand candidate selection and supported XML modes, not a historical five-mode checklist. | [Autowired](https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html) and [XML autowiring](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-autowire.html) |
| p. 3: interface implies JDK proxy | Qualification: this is a common default, not immutable across explicit proxy configuration/integration; self-calls bypass ordinary proxies. | [AOP proxy mechanisms and semantics](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html) |
| p. 4: EhCacheCacheManager / Ehcache 2 profile example | Version change: Framework 6 removed its Ehcache 2 integration; do not reuse that example as current configuration. | [Framework 6.0 removed APIs](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-6.0-Release-Notes#removed-apis) |
| Older annotation imports; null safety absent | Version changes: Framework 7 drops legacy javax annotation/injection support and moves nullness toward JSpecify. | [Framework 7.0 release notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes) and [null safety](https://docs.spring.io/spring-framework/reference/core/null-safety.html) |
| AOT absent from original | Addition: build-time decisions constrain dynamic bean presence. | [AOT introduction and restrictions](https://docs.spring.io/spring-framework/reference/core/aot.html) |

No removal date is asserted where the referenced page establishes current behavior but not its historical timeline.

## 7. High-value Core gaps with practical examples

The following are independent teaching snippets, not one combined application. Unless shown, imports and supporting domain classes are omitted; Spring annotations use `org.springframework.*`, and lifecycle annotations use `jakarta.annotation.*`.

### 7.1 Bean definitions, imports, and conditions

Think of a bean definition as a construction recipe. Spring processes configuration classes, scans, and imports to collect recipes before creating ordinary bean instances. `@Import` brings selected configuration into the context; `@Conditional` decides whether a class or method contributes definitions.

```java
class ReportsEnabled implements Condition {
    @Override
    public boolean matches(ConditionContext context,
                           AnnotatedTypeMetadata metadata) {
        return context.getEnvironment()
                .getProperty("reports.enabled", Boolean.class, false);
    }
}

@Configuration(proxyBeanMethods = false)
class ReportsConfig {
    @Bean
    @Conditional(ReportsEnabled.class)
    ReportFormatter reportFormatter() {
        return new ReportFormatter();
    }
}

@Configuration(proxyBeanMethods = false)
@Import(ReportsConfig.class)
class ApplicationConfig { }
```

With `reports.enabled=true`, the `reportFormatter` bean is registered. Otherwise it is absent, not a bean returning `null`. An unconditional consumer requiring `ReportFormatter` would then fail dependency resolution; make that consumer conditional too or use an optional dependency if absence is supported.

**Interview point:** conditions affect registration during context setup. Changing a property later does not automatically add or remove beans. Boot auto-configuration builds on these foundations but adds its own discovery and condition conventions.

### 7.2 Circular dependencies

This constructor cycle cannot be satisfied: to construct A, Spring needs B; to construct B, it first needs A.

```java
@Service
class ServiceA {
    ServiceA(ServiceB b) { }
}

@Service
class ServiceB {
    ServiceB(ServiceA a) { }
}
```

Context creation fails, typically with a bean-creation exception chain containing `BeanCurrentlyInCreationException`. Prefer redesigning the dependency direction. For example, let a coordinator call two services that do not depend on each other:

```java
@Service
class InventoryService {
    public void reserve(String productId) { /* Reserve inventory. */ }
}

@Service
class PaymentService {
    public void charge(String orderId) { /* Charge payment. */ }
}

@Service
class OrderCoordinator {
    private final InventoryService inventory;
    private final PaymentService payment;

    OrderCoordinator(InventoryService inventory, PaymentService payment) {
        this.inventory = inventory;
        this.payment = payment;
    }

    public void placeOrder(String orderId, String productId) {
        inventory.reserve(productId);
        payment.charge(orderId);
    }
}
```

This is a wiring example, not a complete payment workflow: real workflows need deliberate failure and compensation handling.

**Interview point:** setter/field cycles may be resolved through early singleton references in some configurations, but can expose partially initialized objects and interact badly with proxies. Boot disallows circular references by default. `@Lazy` or a provider can defer one edge, but does not fix a design that needs both objects recursively during initialization.

### 7.3 Environment, properties, profiles, and conversion

`Environment` gives access to property sources and active profiles. `@PropertySource` adds a source; `${...}` is a property placeholder; Spring's conversion infrastructure can convert text to a requested type.

```java
@Configuration(proxyBeanMethods = false)
@PropertySource("classpath:study.properties")
class PropertyConfig {
    @Bean
    static PropertySourcesPlaceholderConfigurer placeholders() {
        return new PropertySourcesPlaceholderConfigurer();
    }

    @Bean
    RetrySettings retrySettings(
            @Value("${retry.max-attempts:3}") int maxAttempts) {
        return new RetrySettings(maxAttempts);
    }
}

record RetrySettings(int maxAttempts) {
    RetrySettings {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be positive");
        }
    }
}
```

With `retry.max-attempts=5` in `study.properties`, the injected value is integer `5`; if the key is missing, the placeholder default is `3`. Invalid numeric text fails conversion. The resource itself must exist here. The static placeholder-configurer bean provides strict placeholder processing in this plain Spring configuration without requiring early construction of `PropertyConfig`.

Programmatic lookup offers the same basic type conversion:

```java
int attempts = environment.getProperty("retry.max-attempts", Integer.class, 3);
```

For competing sources, the first matching source in the configured `PropertySources` order wins. A standard environment includes system properties and environment variables; Boot adds a much richer, documented precedence order. Do not assume Core alone loads Boot's `application.yml`.

**Profiles vs. conditions:** `@Profile("dev")` registers a bean when `dev` is active; `@Conditional(ReportsEnabled.class)` checks custom criteria. Profiles are a named environment-selection mechanism; conditions can inspect properties, classes, or other supported context information. Neither automatically reconfigures existing beans when settings change.

### 7.4 Lifecycle and post-processing edge cases

Use a definition post-processor to change metadata, not to operate on fully initialized application objects:

```java
@Configuration(proxyBeanMethods = false)
class MetadataConfig {
    @Bean
    static BeanFactoryPostProcessor describeFormatter() {
        return factory -> factory.getBeanDefinition("reportFormatter")
                .setDescription("Formats reports for export");
    }

    @Bean
    ReportFormatter reportFormatter() {
        return new ReportFormatter();
    }
}
```

Here the description changes before ordinary bean construction. Avoid calling `getBean()` inside a `BeanFactoryPostProcessor`: it can instantiate beans too early, before all normal post-processing is available. Static `@Bean` methods for these processors avoid prematurely constructing their containing configuration class.

By contrast, a `BeanPostProcessor` receives an actual object in methods such as `postProcessAfterInitialization(Object bean, String beanName)` and can return the original object or a wrapper. Spring's AOP infrastructure uses instance post-processing to create proxies; adding an arbitrary annotation does not create proxy behavior on its own.

For explicit resource lifecycle, Java configuration can name initialization and destruction methods:

```java
@Configuration(proxyBeanMethods = false)
class WorkerConfig {
    @Bean(initMethod = "prestartAllCoreThreads", destroyMethod = "shutdown")
    java.util.concurrent.ThreadPoolExecutor workerPool() {
        return new java.util.concurrent.ThreadPoolExecutor(
                2, 2, 0L, java.util.concurrent.TimeUnit.MILLISECONDS,
                new java.util.concurrent.ArrayBlockingQueue<>(100));
    }
}
```

Spring invokes `prestartAllCoreThreads()` after dependency population to start the pool's core threads, and invokes `shutdown()` when the context closes. `shutdown()` stops accepting work and lets queued work finish; it does not wait for completion. If shutdown must wait or coordinate with other beans, implement a suitable lifecycle policy, often using `SmartLifecycle`, rather than assuming a destruction callback supplies those guarantees.

**Interview point:** prototype beans receive initialization callbacks, but Spring does not automatically invoke their destruction callbacks. Whoever uses a prototype resource must arrange cleanup. Initialization callbacks also run before ordinary after-initialization AOP wrapping, so do not rely on self-invoked transactional or asynchronous behavior in `@PostConstruct`.

### 7.5 Application events and resources

Events decouple the publisher from specific listeners. A plain object can be published; it does not have to extend `ApplicationEvent`.

```java
record OrderPlaced(String orderId) { }

@Service
class OrderPublisher {
    private final ApplicationEventPublisher events;

    OrderPublisher(ApplicationEventPublisher events) {
        this.events = events;
    }

    public void announce(String orderId) {
        events.publishEvent(new OrderPlaced(orderId));
    }
}

@Component
class OrderAuditListener {
    private final AuditRepository audit;

    OrderAuditListener(AuditRepository audit) {
        this.audit = audit;
    }

    @EventListener
    public void onOrderPlaced(OrderPlaced event) {
        audit.record(event.orderId());
    }
}
```

With default event infrastructure, this ordinary listener runs synchronously in the publishing thread. A listener exception can propagate to the publisher. An event does not automatically mean asynchronous delivery, durable messaging, or execution after transaction commit; those require additional infrastructure or a different listener mechanism.

`Resource` abstracts access to classpath, file, and other resource locations. Read a stream rather than assuming a classpath resource is a filesystem file:

```java
Resource template = resourceLoader.getResource("classpath:templates/report.txt");
try (var input = template.getInputStream()) {
    String text = new String(
            input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
    // Render the template text...
}
```

The containing method must handle or declare `IOException`. Stream access works for resources packaged inside a JAR; `getFile()` may not. Close streams and propagate or explicitly handle read failures.

### 7.6 SpEL: expressions are not property placeholders

`${...}` resolves configuration properties. `#{...}` evaluates a Spring Expression Language expression, which can perform operations rather than just retrieve a property:

```java
@Component
class TimingSettings {
    private final long timeoutMillis;

    TimingSettings(@Value("#{30 * 1000}") long timeoutMillis) {
        this.timeoutMillis = timeoutMillis;
    }

    public long timeoutMillis() {
        return timeoutMillis;
    }
}
```

The trusted expression evaluates to `30000`. SpEL also appears in some annotation-driven caching and security configurations, with evaluation contexts defined by those features.

**Safety point:** do not pass user-controlled text to a general-purpose SpEL parser/evaluation context. Powerful expressions can access methods, types, or objects exposed by the context. Prefer parsing ordinary data and applying explicit application rules. If constrained expressions are a real requirement, use a restricted context such as an appropriately configured `SimpleEvaluationContext` and tightly limit exposed objects and operations; it is not an automatic security boundary for arbitrary input.

### 7.7 Unit tests vs. Spring container tests

Test ordinary business behavior by directly constructing the object. No Spring context is needed to verify this calculation:

```java
class PriceCalculator {
    int total(int unitPrice, int quantity) {
        return Math.multiplyExact(unitPrice, quantity);
    }
}

class PriceCalculatorTest {
    @org.junit.jupiter.api.Test
    void multipliesUnitPriceByQuantity() {
        var calculator = new PriceCalculator();
        org.junit.jupiter.api.Assertions.assertEquals(600, calculator.total(200, 3));
    }
}
```

Use a container test when the behavior under test is Spring wiring, qualifiers, conditions, lifecycle, or proxies. This JUnit Jupiter example uses Spring TestContext, not a full Boot application:

```java
@org.springframework.test.context.junit.jupiter.SpringJUnitConfig(
        CalculatorConfig.class)
class CalculatorWiringTest {
    @Autowired
    PriceCalculator calculator;

    @org.junit.jupiter.api.Test
    void injectsConfiguredCalculator() {
        org.junit.jupiter.api.Assertions.assertEquals(600, calculator.total(200, 3));
    }
}

@Configuration(proxyBeanMethods = false)
class CalculatorConfig {
    @Bean
    PriceCalculator priceCalculator() {
        return new PriceCalculator();
    }
}
```

This checks that the configured bean can be injected. It is not a substitute for tests of specific qualifier or proxy behavior: those tests must invoke the managed bean and assert the behavior in question. Container tests require `spring-test` and the JUnit Jupiter dependencies; plain unit tests require only their test framework.

## 8. Spring and AI in 2026: what to know, and what not to mix in

AI is not a new Spring Core container concept. **Spring AI is a separate application framework** that builds on the Spring ecosystem. For a general Spring interview, do not replace Core fundamentals with a tour of AI libraries. Instead, be able to explain how a Spring service integrates an AI capability safely and reliably:

- Keep model/provider calls behind a well-defined application boundary; inject clients/configuration rather than scattering provider calls through business code.
- Treat prompts, retrieved documents, tool outputs, and model responses as untrusted input. Apply authorization to retrieved data and validate model output before it triggers business actions.
- Discuss timeouts, retries with limits, rate limits, fallbacks, streaming, cost/latency budgets, privacy, and observability.
- Evaluate AI behavior with representative tests and quality/safety evaluation, not only “the call returned 200.” Keep a human approval boundary for consequential actions.
- Know that Spring AI offers provider abstractions, structured outputs, tool/function calling, vector stores, RAG, observability, and evaluation—but study those only if the role expects AI application development.

These are application-design considerations, not Spring Core interview checkboxes. Keep them in a short “AI integration” addendum or the Boot/application architecture notes.

## 9. Spring Framework 7 context

As of 2026, Spring Framework 7.0 is a relevant major line, while many production systems and interviews still target 6.x. Confirm the target application's version instead of assuming every role uses 7.0.

- Framework 7.0 retains a **JDK 17 minimum** and recommends JDK 25; it aligns with Jakarta EE 11. Be ready to distinguish a framework minimum from an employer's runtime choice.
- `javax.annotation` and `javax.inject` annotations are no longer supported in Framework 7; use their `jakarta.*` equivalents where applicable.
- Framework 7 deprecates Spring's older null-safety annotations in favor of **JSpecify**.
- **AOT processing** performs context analysis at build time and generates code/runtime hints, especially for native-image use. The trade-off is that classpath and conditions affecting bean presence need to be fixed at build time; highly dynamic bean registration may not fit.

Do not memorize every version-specific removal for a general Core screen. Learn the current baseline and be able to discuss why AOT/native images constrain dynamic configuration.

## 10. Interview questions with answers

Practice giving the **short answer** first, then explain the example or pitfall if asked. Snippets are independent and omit imports and supporting domain classes unless needed; they are not one combined application.

### 10.1 Why is constructor injection usually preferred, and when would you not use it?

**Short answer:** it makes required dependencies explicit, allows `final` fields, and lets you construct a usable object directly in a unit test. Use setter injection when a dependency is genuinely optional, intentionally replaceable, or the object's construction is controlled by an API that requires later configuration.

```java
@Service
class CheckoutService {
    private final PaymentGateway gateway;

    CheckoutService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

A sole constructor needs no `@Autowired`. Optional dependencies can still be constructor-injected using `Optional<T>` or a provider. Constructor injection does not automatically validate `null` supplied by ordinary Java callers, and switching to setters is not a good fix for circular design.

**Follow-up: multiple constructors?** mark the intended constructor with `@Autowired`, or construct explicitly in an `@Bean` method. With multiple unannotated constructors, Spring normally uses a no-argument constructor if present; do not assume it chooses the largest one. See section 1 for the full selection table.

### 10.2 How does Spring choose among two beans of the same type?

**Short answer:** it first finds type-compatible candidates, then uses selection rules such as qualifiers and a primary candidate. If a required single dependency remains ambiguous, bean creation fails rather than selecting randomly.

```java
@Component
@Primary
class StripeGateway implements PaymentGateway { }

@Component("paypalGateway")
class PayPalGateway implements PaymentGateway { }

@Service
class CheckoutService {
    CheckoutService(@Qualifier("paypalGateway") PaymentGateway gateway) { }
}
```

This injection selects PayPal. Without the qualifier, Stripe is the default because it is primary. A matching injection-point name can help in supported configurations; constructor parameter-name matching requires retained parameter metadata, typically compilation with `-parameters` in modern Spring. Explicit qualifiers are clearer than relying on names.

**Pitfall:** `@Order` is not a substitute for selecting one bean. Inject `List<PaymentGateway>` when all matching gateways are intended; `@Primary` does not reduce that collection to one element.

### 10.3 What exactly does singleton scope guarantee, and what does it not guarantee?

**Short answer:** one managed instance per bean definition per container. It does not mean one instance per JVM, one per class, or automatic thread safety.

```java
@Configuration(proxyBeanMethods = false)
class CounterConfig {
    @Bean
    Counter firstCounter() { return new Counter(); }

    @Bean
    Counter secondCounter() { return new Counter(); }
}
```

These are two singleton bean definitions of the same class, so they produce two distinct instances. Separate contexts can also have separate instances.

**Concurrency pitfall:** a singleton field updated with `count++` is not safe under concurrent use. Prefer stateless services; if shared mutable state is necessary, use an appropriate concurrency strategy such as `AtomicInteger` for a simple independent counter. Making a field `final` does not make the referenced mutable object thread-safe.

### 10.4 What happens when a singleton injects a request-scoped dependency?

**Short answer:** use a scoped proxy or provider to bridge the lifetime mismatch. The singleton retains a stable proxy/lookup handle, not one request's concrete object.

```java
@Component
@RequestScope
class RequestDetails {
    public String requestId() { return "..."; }
}

@Service
class RequestLogger {
    private final RequestDetails details;

    RequestLogger(RequestDetails details) {
        this.details = details;
    }

    public String currentId() {
        return details.requestId();
    }
}
```

`@RequestScope` enables a scoped proxy by default: calls during A reach A's target; calls during B reach B's target. Calling the target outside an active request fails. Plain `@Scope("request")` does not enable a proxy by default, so direct injection into an eager singleton normally fails at startup.

**Provider alternative:** inject `ObjectProvider<RequestDetails>` and call `getObject()` at the point of use. Never cache the resolved request object in a singleton field. See section 2 for the complete no-proxy alternative.

### 10.5 What is the difference between a `BeanFactoryPostProcessor` and a `BeanPostProcessor`?

**Short answer:** a factory post-processor changes the recipe; a bean post-processor processes the object created from it.

| Extension point | Operates on | Typical use |
| --- | --- | --- |
| `BeanFactoryPostProcessor` | Definitions before ordinary bean instantiation | Modify property values or other metadata |
| `BeanPostProcessor` | Instances during bean creation | Process instance annotations or return a proxy |

```java
@Bean
static BeanFactoryPostProcessor describeBean() {
    return factory -> factory.getBeanDefinition("reportFormatter")
            .setDescription("Report export formatter");
}
```

This changes metadata without obtaining the formatter instance; it assumes that definition is registered. By contrast, `postProcessAfterInitialization(Object bean, String beanName)` receives the instance and can return it or a compatible wrapper.

**Pitfall:** calling `getBean()` from a factory post-processor can instantiate beans before normal processing is ready. A `BeanDefinitionRegistryPostProcessor` is a related extension for registering additional definitions, not just changing existing ones.

### 10.6 Where do initialization callbacks and AOP proxying fit in the bean lifecycle?

**Short answer:** dependencies are populated before initialization callbacks; ordinary AOP wrapping usually happens during after-initialization post-processing.

```text
Construction → dependency population → relevant Aware callbacks
    → before-initialization post-processing
    → initialization callbacks
    → after-initialization post-processing, possibly returning a proxy
    → use → destruction when the context closes
```

When all three distinct initialization mechanisms are configured, their order is normally `@PostConstruct`, `InitializingBean.afterPropertiesSet()`, then the custom `initMethod`. This is a simplified ordinary lifecycle; specialized processors can also act earlier.

**Pitfall:** do not expect a method invoked through `this` inside `@PostConstruct` to receive transactional or asynchronous proxy advice. Use initialization for local setup, not complex coordination requiring fully ready, advised collaborators. A later context event or lifecycle hook may fit that work.

### 10.7 Why can `@Transactional` or other advice be skipped on self-invocation?

**Short answer:** Spring's ordinary AOP advice runs when a call crosses the proxy. A call from one target method to another on `this` never crosses it.

```java
@Service
class ImportService {
    public void importAll() {
        saveOne(); // Self-invocation bypasses transactional interception.
    }

    @Transactional
    public void saveOne() { /* Save a record. */ }
}
```

Calling `importAll()` through the proxy does not start a transaction solely because `saveOne()` is annotated. If an outer transaction already exists, `saveOne()` may execute inside it, but its own annotation is not independently applied.

Prefer moving the advised operation to a separate bean:

```java
@Service
class RecordWriter {
    @Transactional
    public void saveOne() { /* Save a record. */ }
}

@Service
class ImportService {
    private final RecordWriter writer;

    ImportService(RecordWriter writer) {
        this.writer = writer;
    }

    public void importAll() {
        writer.saveOne(); // Crosses the injected writer's proxy.
    }
}
```

This assumes transaction management is enabled and a suitable transaction manager is configured. `@Transactional` alone does not establish the infrastructure. Similar proxy-boundary issues affect caching, asynchronous execution, and other proxy-based advice.

### 10.8 What can go wrong with circular dependencies?

**Short answer:** constructor cycles cannot create either object first. Setter/field cycles can involve early, partially initialized references and proxy complications; redesign is usually better.

```text
ServiceA constructor needs ServiceB
ServiceB constructor needs ServiceA
→ Neither can be constructed first.
```

Extract a shared responsibility or introduce a coordinator that calls independent services. `@Lazy` or a provider can defer one edge, but still fails if construction immediately triggers the lookup and recreates the cycle. Boot disallows circular references by default; relying on configuration that permits early references makes the design brittle.

### 10.9 What does `@Lazy` actually defer?

**Short answer:** on a bean definition, it defers initialization until needed; on an injection point, it injects a proxy that resolves the target on use.

```java
@Component
@Lazy
class ExpensiveClient {
    public String fetch() { return "..."; }
}

@Service
class ReportService {
    private final ExpensiveClient client;

    ReportService(@Lazy ExpensiveClient client) {
        this.client = client;
    }

    public String report() {
        return client.fetch();
    }
}
```

The lazy injection-point proxy lets `ReportService` be constructed without resolving the client target. If you remove the parameter's `@Lazy`, this eager service directly needs the client and can force it to initialize despite the client's bean-level `@Lazy`.

**Pitfall:** laziness can move configuration/connection failures from startup to the first operation. It does not change scope or guarantee thread safety. Injecting a provider alone also does not stop a non-lazy singleton from being eagerly created elsewhere by the context.

### 10.10 What changes with AOT/native-image constraints?

**Short answer:** more container decisions are analyzed at build time, and dynamic behavior may require generated code or runtime hints. Native images have closed-world constraints on reflection, resources, and dynamic proxies.

#### What is AOT?

**AOT means Ahead of Time:** doing analysis or compilation before the application runs. In this topic, distinguish two related steps:

| Step | What it does | Output |
| --- | --- | --- |
| Spring AOT processing | Analyzes the application context and generates assets for the known bean configuration | Java source, proxy-related bytecode, and runtime hints |
| GraalVM Native Image compilation | Analyzes reachable code and compiles the application and required runtime support for a target platform | Native executable |

Ordinary Java compilation already converts `.java` source into `.class` bytecode before execution. Spring AOT is additional work: it moves container discovery and setup decisions from startup to the build. It does not simply mean running `javac`.

On a conventional JVM, a JIT (Just-In-Time) compiler can optimize frequently executed code while the application runs. Native Image instead compiles ahead of execution. Spring AOT-generated code can also run on a JVM, where JIT compilation is still possible.

```text
Conventional JVM application:
    Java source → bytecode/JAR
    → startup scans/parses Spring configuration
    → creates and wires beans → handles requests on the JVM

Spring AOT on JVM:
    Java source + build-time context analysis → generated assets + JAR
    → startup uses generated context setup → handles requests on the JVM

Native application:
    Spring AOT assets + application + dependencies
    → Native Image compilation → platform-specific executable
    → startup uses generated context setup → handles requests
```

Spring AOT does not create and freeze every business object at build time. It primarily processes bean definitions; ordinary application instances are still constructed at runtime, with their scopes and lifecycle behavior. Some infrastructure processors do run during the build, so build-time processing must not depend on production services being available.

#### Example 1: replace repeated discovery with generated setup

```java
@Configuration(proxyBeanMethods = false)
class ClockConfig {
    @Bean
    java.time.Clock clock() {
        return java.time.Clock.systemUTC();
    }
}
```

In conventional startup, Spring discovers and interprets this configuration to register the `clock` definition. AOT processing inspects it at build time and generates code to register an equivalent definition and invoke its factory method.

**What stays the same:** it is still a managed singleton by default, and `clock()` creates the runtime instance when needed. **What changes:** startup can use generated setup instead of repeating the same configuration discovery. You normally maintain the configuration, not the generated classes.

#### Example 2: bean-presence decisions vs. runtime property values

Consider a configuration using the custom `ReportsEnabled` condition from section 7.1:

```java
@Configuration(proxyBeanMethods = false)
class ReportsConfig {
    @Bean
    @Conditional(ReportsEnabled.class)
    ReportFormatter reportFormatter() {
        return new ReportFormatter();
    }
}
```

If `reports.enabled=false` during AOT processing, the formatter definition is excluded from the generated model. Setting `reports.enabled=true` only when launching that AOT application does not cause a fresh scan to introduce the excluded bean.

`@Profile` has the same kind of constraint: profiles controlling registration must be selected during AOT processing. AOT builds are therefore sensitive to the build-time environment used for the bean graph.

That does **not** mean every setting must be hard-coded. An existing bean can read a runtime value:

```java
@Configuration(proxyBeanMethods = false)
class RetryConfig {
    @Bean
    RetrySettings retrySettings(Environment environment) {
        int attempts = environment.getProperty(
                "retry.max-attempts", Integer.class, 3);
        return new RetrySettings(attempts);
    }
}
```

Here `RetrySettings` is the validated record from section 7.3. Its bean definition is always present; the factory method reads the property when creating the bean at runtime. Different launches can use different values without changing the bean graph.

**Design distinction:** "enable this already-registered service's operation" can be runtime configuration. "introduce a previously absent implementation or configuration class" is a bean-graph change and cannot be assumed to work in AOT mode.

#### Example 3: reflection needs discoverable metadata

Native Image uses a **closed-world assumption**: required classes and capabilities must be known to its build analysis. Direct Java calls are generally discoverable; dynamically selected reflective calls may need explicit reachability metadata.

For instance, suppose a library reflectively creates this type and invokes its getter:

```java
public class ExportSummary {
    public ExportSummary() { }

    public String getStatus() {
        return "ready";
    }
}
```

If the build cannot infer those operations and no integration supplies hints, register exactly the capabilities the library needs. The following classes belong in their own source files:

```java
import org.springframework.aot.hint.MemberCategory;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;

public class ExportHints implements RuntimeHintsRegistrar {
    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.reflection().registerType(
                ExportSummary.class,
                MemberCategory.INVOKE_PUBLIC_CONSTRUCTORS,
                MemberCategory.INVOKE_PUBLIC_METHODS);
        hints.resources().registerPattern("templates/report.txt");
    }
}
```

```java
@Configuration(proxyBeanMethods = false)
@ImportRuntimeHints(ExportHints.class)
class ExportConfig { }
```

`@ImportRuntimeHints` is `org.springframework.context.annotation.ImportRuntimeHints`. Import `ExportConfig` into the application's configuration, or ensure it is discovered. Register narrower individual members when practical; do not blanket-register unrelated classes.

These hints describe capabilities needed at runtime; they do not instantiate `ExportSummary` or make it a Spring bean. Spring and supported libraries already generate many hints, including common serialization integration. Add manual hints for uncovered behavior rather than assuming every DTO needs them.

#### Example 4: classpath resources must be included

The resource hint above includes `templates/report.txt` in the native executable's resources. The file must also exist on the build classpath, typically under a build tool's main resources directory.

```java
Resource template = resourceLoader.getResource("classpath:templates/report.txt");
try (var input = template.getInputStream()) {
    byte[] contents = input.readAllBytes();
    // Render the template...
}
```

The containing method handles or declares `IOException`. A resource can be present in a JVM JAR yet absent from a native executable if its use was not discovered or registered. Use streams: even when included, it is not necessarily a physical `File`.

JDK proxy interface combinations can also need hints when created dynamically; standard Spring-managed proxies are commonly handled by Spring AOT. Native Image does not support arbitrary runtime loading of new plugin bytecode simply because it worked on the JVM.

#### Benefits, trade-offs, and how to validate

Native applications often start faster and use less memory, which can help short-lived workloads or scaling. These are measurements to verify, not guarantees: native builds take longer, produce target-specific executables, and can have different throughput and debugging characteristics from a warmed-up JVM.

An AOT-generated JAR still requires a JVM. A native executable normally does not require a separately installed JVM, but it still depends on a compatible operating system, architecture, and any required native libraries.

**Validation:** exercise the AOT/native application itself, especially reflection, serialization, resources, proxies, and the intended configuration. Passing ordinary JVM tests does not prove native compatibility. Hint tests or a tracing agent can help identify metadata needs, but exercised paths are not proof that all paths are covered.

**Interview answer:** "Spring AOT analyzes a fixed application configuration at build time and generates context setup and runtime hints. Native Image then compiles reachable code into a native executable. Bean-registration choices must be established at build time, runtime values for existing beans can still vary, and dynamic reflection/resources/proxies need discoverable or registered metadata."

Reference: [Spring AOT optimizations, restrictions, generated assets, and JVM execution](https://docs.spring.io/spring-framework/reference/core/aot.html).

### 10.11 How do Java configuration and component scanning differ?

**Short answer:** `@Bean` methods explicitly supply managed objects; scanning discovers eligible annotated classes in selected packages.

```java
@Configuration(proxyBeanMethods = false)
@ComponentScan(basePackageClasses = CheckoutService.class)
class AppConfig {
    @Bean
    java.time.Clock clock() {
        return java.time.Clock.systemUTC();
    }
}
```

This scans application services and explicitly registers a JDK object that you cannot annotate yourself. They are complementary styles. A stereotype outside the scan boundary is not discovered, and accidental registration by both styles can create duplicate candidates.

### 10.12 What changes with `@Configuration(proxyBeanMethods = false)`?

**Short answer:** calls between `@Bean` methods become ordinary Java calls instead of container-intercepted calls.

```java
@Bean
CheckoutService checkoutService(PaymentGateway gateway) {
    return new CheckoutService(gateway);
}
```

Use parameters to obtain managed dependencies rather than calling `paymentGateway()` yourself. The container still manages beans registered by these methods, including their singleton scope; disabling interception does not make all beans prototypes.

### 10.13 What is a provider, and does each lookup create a new object?

**Short answer:** a provider is an injected lookup handle. Scope, not the provider, decides instance reuse.

```java
class ExportService {
    private final ObjectProvider<ReportFormatter> formatters;

    ExportService(ObjectProvider<ReportFormatter> formatters) {
        this.formatters = formatters;
    }

    String export(Report report) {
        return formatters.getObject().format(report);
    }
}
```

Register this service as a bean for Spring to inject the provider. Singleton lookup reuses the managed instance; prototype lookup creates a new one; request lookup follows the active request. `getIfAvailable()` allows absence, not unresolved ambiguity or failed creation. `jakarta.inject.Provider<T>.get()` is the standard Jakarta required-lookup alternative.

### 10.14 What if a singleton directly injects a prototype bean?

**Short answer:** the prototype is resolved once while creating the singleton, so the singleton keeps that same injected instance. Prototype scope does not make each method call create a new dependency.

```java
@Component
@Scope("prototype")
class ExportJob {
    public void run() { /* Perform one export. */ }
}

@Service
class ExportRunner {
    private final ObjectProvider<ExportJob> jobs;

    ExportRunner(ObjectProvider<ExportJob> jobs) {
        this.jobs = jobs;
    }

    public void export() {
        jobs.getObject().run();
    }
}
```

Here each `export()` performs a new prototype lookup. If the job owns resources, arrange cleanup explicitly: Spring does not automatically destroy prototypes after use.

### 10.15 How do JDK proxies and CGLIB proxies differ?

**Short answer:** JDK proxies implement interfaces; CGLIB proxies subclass the target class.

Injecting an interface is compatible with either style when that interface is exposed by the proxy. A JDK proxy is not assignable to the concrete implementation class. CGLIB cannot subclass a final class or override final methods; private methods and self-invocations are not ordinary proxy interception points.

**Pitfall:** do not assume a single proxy default across plain Spring and Boot integrations. Check the actual configuration. AspectJ weaving is different from these proxy mechanisms and can intercept behavior that ordinary Spring proxies cannot.

### 10.16 Is `@PostConstruct` the same as a constructor, and who performs cleanup?

**Short answer:** the constructor creates the object; `@PostConstruct` is a container-managed callback after dependency population. Ordinary `new` does not run that callback automatically.

```java
@Component
class TemplateCache {
    @jakarta.annotation.PostConstruct
    public void initialize() { /* Prepare local cache state. */ }

    @jakarta.annotation.PreDestroy
    public void release() { /* Release owned resources. */ }
}
```

Spring invokes these for appropriately managed beans. Destruction depends on scope and a normal context shutdown; prototype destruction is not automatic, and abrupt process termination need not execute callbacks. `try`-with-resources around a standalone context ensures it is closed on normal exit.

### 10.17 How are profiles, conditions, placeholders, and SpEL different?

| Mechanism | Question it answers | Example |
| --- | --- | --- |
| `@Profile` | Is this named profile active? | `@Profile("dev")` |
| `@Conditional` | Does a registration criterion match? | `@Conditional(ReportsEnabled.class)` |
| Property placeholder | What configured value should be injected? | `@Value("${retry.max-attempts:3}")` |
| SpEL | What does this expression evaluate to? | `@Value("#{30 * 1000}")` |

Profiles and conditions control bean registration; placeholders and expressions supply values. Core property precedence comes from ordered property sources; Boot supplies additional sources and conventions. Never evaluate arbitrary user-provided text as unrestricted SpEL.

### 10.18 Are application events asynchronous or delivered after commit?

**Short answer:** not automatically. Ordinary listeners use synchronous delivery by default; publishing is neither durable messaging nor an after-commit guarantee.

```java
@EventListener
public void onOrderPlaced(OrderPlaced event) {
    audit.record(event.orderId());
}
```

With default infrastructure this runs in the publisher's thread, and an exception can propagate. Async execution requires explicit configuration; transaction-phase listeners such as `@TransactionalEventListener` have separate semantics. Durable, cross-process delivery requires messaging/outbox infrastructure, not just `publishEvent()`.

#### How to make a particular listener asynchronous

By default, publication calls an ordinary listener before returning:

```text
Publisher thread: publishEvent → listener runs → listener finishes → continue
```

If that listener throws with the default synchronous infrastructure, the exception can escape `publishEvent()`, preventing the publisher's next statement from running. This is ordinary synchronous call behavior, not an automatic event retry mechanism.

Enable async method interception, configure a bounded executor, and annotate the listener with `@Async`. The following configuration must be registered in the context, and the listener must be a managed bean:

```java
@Configuration(proxyBeanMethods = false)
@EnableAsync
class EventAsyncConfig {
    @Bean("eventExecutor")
    ThreadPoolTaskExecutor eventExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("events-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        return executor;
    }
}
```

Imports: `org.springframework.scheduling.annotation.EnableAsync`, `org.springframework.scheduling.annotation.Async`, and `org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor`. Spring initializes and shuts down the managed executor; do not manually call `initialize()` here.

```java
@Component
class OrderAuditListener {
    private final AuditRepository audit;

    OrderAuditListener(AuditRepository audit) {
        this.audit = audit;
    }

    @Async("eventExecutor")
    @EventListener
    public void onOrderPlaced(OrderPlaced event) {
        audit.record(event.orderId());
    }
}
```

The publisher remains unchanged:

```java
events.publishEvent(new OrderPlaced(orderId));
// Continue without waiting for this async listener to finish.
```

```text
Publisher thread: publishEvent → submit listener task → continue
Worker thread:                      listener runs → finishes or fails
```

Spring's async proxy submits the invocation to `eventExecutor`. The default event dispatcher can still call other synchronous listeners in the publisher's thread. `@EnableAsync` alone does not make every listener asynchronous, and `@Async` requires enabled infrastructure and a call through the managed proxy.

**Errors and limits:** exceptions thrown inside this `void` async listener do not travel back to the publisher. Spring's default `AsyncUncaughtExceptionHandler` logs them; configure a custom handler through `AsyncConfigurer` for application-specific reporting. A publisher-side `try/catch` cannot catch later worker failures. Submission itself can fail, such as when the bounded executor is saturated; the default rejection behavior throws rather than silently dropping work, and that error can reach the publisher.

**Context and delivery:** the publisher's thread-bound transaction, request context, and other thread-local state are not automatically transferred to the worker. Pass immutable event data, not a request-scoped bean or mutable persistence entity. If listener work needs a transaction, establish one on the worker; that still does not guarantee the publisher has committed before the listener starts. Use transaction-phase events deliberately for after-commit timing and durable messaging/outbox infrastructure if events must survive process failure.

Completion order is not guaranteed across async tasks. The shutdown settings above allow a bounded wait for queued work during normal shutdown, not a guarantee of delivery after crashes or forced termination.

### 10.19 When should you use a unit test vs. a Spring context test?

**Short answer:** directly construct objects for business logic; start a targeted context when testing container behavior.

```java
var service = new CheckoutService(fakeGateway); // Plain unit-test setup.
```

Use Spring TestContext for candidate selection, scoped behavior, lifecycle, or proxy advice. To verify transactions or caching, invoke the managed bean and assert the actual behavior; `new` bypasses proxy-based features. Prefer focused contexts over loading an entire Boot application for a simple calculation.

### 10.20 What is `FactoryBean<T>`, and is it a post-processor?

**Short answer:** no. A `FactoryBean<T>` is a managed factory whose product is exposed as the normal bean lookup result. It is different from `BeanFactory`, `BeanFactoryPostProcessor`, and a provider.

For a registered factory named `client`:

```java
Object product = context.getBean("client");
Object factory = context.getBean("&client");
```

The first retrieves the product; `&` retrieves the factory itself. The factory's `isSingleton()` describes product reuse, which is distinct from the factory object's own bean scope. Framework integrations use this pattern when producing an object requires specialized construction.

### 10.21 Does `@Service` automatically add transactions or other advice?

**Short answer:** no. It is a component stereotype describing a service role and enabling discovery when scanned.

Transactions, caching, async execution, and method security need their own infrastructure and configuration. `@Repository` similarly depends on exception-translation infrastructure. If annotated behavior is missing, check bean registration, infrastructure, proxy compatibility, method visibility, and whether the call crosses the proxy before assuming the annotation is broken.

### 10.22 Why use `Resource` instead of converting everything to `File`?

**Short answer:** not every resource is a filesystem file. A classpath resource can live inside a JAR.

```java
Resource resource = resourceLoader.getResource("classpath:templates/report.txt");
try (var input = resource.getInputStream()) {
    byte[] contents = input.readAllBytes();
    // Consume the bytes...
}
```

The containing method must handle or declare `IOException`. Stream access works for packaged resources; `getFile()` may fail. Use bounded reads where resource size can be large or untrusted, and close the stream.

## Recommended study order across your separate notes

Use a **layered study order**, but it is fine to share all four companion files together when you want a consistency review:

1. **Spring Core** — container, DI, lifecycle, scopes, AOP, environment.
2. **Spring Boot** — auto-configuration, starters, externalized configuration, profiles, actuator, testing conventions.
3. **Spring MVC** — request handling, binding/validation, exception handling, serialization, filters/interceptors.
4. **Spring Data** — repository abstraction, query methods, transactions, persistence-context behavior, pagination and performance.
5. **Spring Security** — filter chain, authentication vs. authorization, security context, method security, CSRF/CORS, OAuth2/resource-server basics.

This order follows dependency direction and avoids mixing framework fundamentals with product-specific behavior. Review Security and Data in the context of MVC/Boot when you reach those layers, since many practical questions cross boundaries. Keep a small index/overview rather than merging all subjects into one oversized document.

If you send the remaining notes in one go, they can be cross-checked for duplicated explanations, conflicts, stale claims, and topic boundaries. The actual learning/revision should still be staggered in the order above.

## Official references

- [Spring Framework 7.0 release notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)
- [Core container and bean reference](https://docs.spring.io/spring-framework/reference/core/beans.html)
- [Dependency injection](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html)
- [Bean lifecycle callbacks](https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html)
- [Spring AOP proxying](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)
- [AOT optimizations](https://docs.spring.io/spring-framework/reference/core/aot.html)
- [Spring null-safety and JSpecify](https://docs.spring.io/spring-framework/reference/core/null-safety.html)
- [Spring AI project](https://spring.io/projects/spring-ai)
