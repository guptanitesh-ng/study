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

### Dependency resolution

Spring resolves dependencies primarily by type, then applies candidate-selection rules such as `@Qualifier`, `@Primary`, and priority where applicable. A field or constructor parameter name can also help disambiguate in supported configurations. `@Order` can order injected collections; it is not a replacement for qualifying a single dependency. Saying injection is type-based is valid shorthand, but incomplete when multiple candidates exist.

- Use `@Qualifier` to select a specific candidate and `@Primary` to define a preferred default.
- For multiple candidates, inject a collection or `Map<String, T>` when that is the intended design.
- For an optional or deferred dependency, consider `Optional<T>`, `ObjectProvider<T>`, or the supported `jakarta.inject.Provider<T>` API.
- Constructor injection is a common modern default; `@Autowired` is not required on a sole constructor.

## 2. Container, bean definitions, and scopes

- `BeanFactory` is the foundational container API. `ApplicationContext` builds on it and adds application-level facilities such as events, message resolution, and resource loading.
- A typical `ApplicationContext` eagerly creates non-lazy singleton beans during refresh; a basic `BeanFactory` is more often used in a lazy fashion. This is a default behavior, not an absolute rule: lazy settings and bean dependencies affect when objects are instantiated.
- A **bean definition** is configuration/metadata for creating a bean; it is not the bean instance itself.
- **Singleton** means one instance per bean definition per container, not one instance for the whole JVM. It says nothing about thread safety. Stateless singleton services are a common pattern; mutable shared state needs deliberate concurrency control.
- **Prototype** creates a new instance for each request from the container. Spring does not manage the full destruction lifecycle of prototype instances after handing them to the caller.
- Web-aware contexts can provide **request** and **session** scopes. A singleton that depends on a shorter-lived bean needs an appropriate proxy or provider so it does not capture one short-lived instance forever. `globalSession` is a legacy, portal-specific scope and is rarely relevant.
- Other current web scopes include **application** (per `ServletContext`) and **websocket** (for supported WebSocket sessions). They are not the same as a singleton per Spring container.
- Inner beans are a legacy XML technique for an object used only at one injection point. Modern Java configuration usually expresses the same relationship directly.

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

## 7. High-value Core gaps to add to your interview preparation

Prioritize these beyond the original PDF:

1. **Bean definition processing and auto-configuration foundations**: how configuration classes, imports, component scanning, conditions, and post-processors contribute bean definitions. Boot-specific auto-configuration details belong in the Boot file.
2. **Circular dependencies**: why constructor cycles cannot be resolved by constructing both objects, why setter/field cycles are problematic, and why redesign is usually better than relying on early references.
3. **Configuration and environment**: `Environment`, property sources, placeholders, type conversion, profiles vs. conditions, and how configuration precedence is established (Boot expands this).
4. **Lifecycle edge cases**: `BeanFactoryPostProcessor` vs. `BeanPostProcessor`, proxy creation, prototype destruction, and startup/shutdown callbacks.
5. **Application events and resources**: the `ApplicationContext` event mechanism and `Resource` abstraction; know enough to explain why they exist and when they help.
6. **SpEL and safety**: where expressions are used, the difference between trusted and untrusted expression input, and why user-controlled expressions need careful handling.
7. **Testing**: unit-test plain objects without starting the container where possible; use Spring TestContext integration when the container behavior itself is under test.

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

## 10. Interview self-check

Try to answer these without reciting definitions:

- Why is constructor injection usually preferred, and when would you not use it?
- How does Spring choose among two beans of the same type?
- What exactly does singleton scope guarantee—and what does it not guarantee?
- What happens when a singleton injects a request-scoped dependency?
- What is the difference between a `BeanFactoryPostProcessor` and a `BeanPostProcessor`?
- Where do initialization callbacks and AOP proxying fit in the bean lifecycle?
- Why can `@Transactional` or another advice be skipped on a self-invocation?
- What can go wrong with circular dependencies?
- What does `@Lazy` actually defer?
- What changes when an application is built with AOT/native-image constraints?

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
