# Spring Boot: Interview Notes

Reviewed: October 31, 2026. Source: the four-page Spring Boot PDF, dated September 23, 2020, with later Spring Cloud material.

This is an editorial Markdown conversion, not a verbatim transcript: original topics are retained in condensed form, outdated claims are corrected, and additions are identified. Screenshots/diagrams are not reproduced; text references to them are not a substitute for inspecting the PDF. Priorities below are study recommendations, not predictions of a particular interview.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> **Boot** -> [REST + MVC](Spring-REST-MVC-Interview-Notes.md) -> [Data](Spring-Data-Interview-Notes.md) -> [Security](Spring-Security-Interview-Notes.md).

## How to learn from these examples

Use this recurring scenario: **an order application** accepts orders, stores them in a database, and calls an external delivery service. Ask what Boot configures, what you override, and what happens when a dependency fails.

Examples are independent teaching snippets, not one combined application. Imports and domain implementations are omitted unless important. Use the Boot-managed dependency set for your selected release. Web, validation, Actuator, database and test examples require their corresponding dependencies; annotations alone do not install infrastructure. Where Boot 3 and 4 differ, examples identify the boundary instead of assuming interchangeable imports.

## Start here: learn Boot by running one small application

Read the interview sections **after** this walkthrough. Your first goal is not to memorize annotations; it is to observe: "I sent this request, these objects handled it, and this setting changed the result."

This walkthrough is one coherent application, unlike the independent snippets later. It creates an order and reads it back from memory. There is intentionally no database, authentication, broker or external API yet. The code below is a recipe to run in a separate generated project, not an application already created or executed in this notes repository.

### Step 1: generate the project rather than assembling dependencies manually

Open [Spring Initializr](https://start.spring.io/) and select Maven, Java, JAR packaging, and a stable Boot release offered by the generator. Choose Java 21 if supported by that release and installed locally; otherwise choose a supported Java version you have installed.

Use group `example`, artifact `orders`, and package name `example.orders`. Add **Spring Web**, **Validation**, and **Spring Boot Actuator**. Download and extract the project to a separate folder. Do not add Security or a database dependency for this first exercise.

The generator supplies a compatible dependency set and Maven wrapper. Keep its `pom.xml`; do not paste dependencies from a tutorial targeting another Boot generation.

| Generated item | What you use it for |
| --- | --- |
| `pom.xml` | Declares dependencies and build plugins |
| `mvnw.cmd` | Runs Maven on Windows without a separate Maven installation |
| `src\main\java\example\orders` | Application Java files |
| `src\main\resources\application.properties` | Application settings |
| `src\test\java` | Tests, including the generated context test |

Check `java -version` and `.\mvnw.cmd -version` from the extracted project folder. The Maven wrapper may download Maven/dependencies on first use. Maven must use a Java version compatible with the generated project.

### Step 2: define what an order looks like

Create `src\main\java\example\orders\Order.java`:

```java
package example.orders;

import java.util.UUID;

public record Order(UUID id, String product, int quantity, String status) { }
```

This is ordinary Java data. It is **not** a Spring bean. One `Order` will be created for each accepted order, rather than asking Spring to create it as a singleton.

### Step 3: put the behavior in a service

Create `src\main\java\example\orders\OrderService.java`:

```java
package example.orders;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final ConcurrentHashMap<UUID, Order> orders = new ConcurrentHashMap<>();
    private final String initialStatus;

    public OrderService(@Value("${orders.initial-status:accepted}") String initialStatus) {
        this.initialStatus = initialStatus;
    }

    public Order create(String product, int quantity) {
        Order order = new Order(UUID.randomUUID(), product, quantity, initialStatus);
        orders.put(order.id(), order);
        return order;
    }

    public Optional<Order> find(UUID id) {
        return Optional.ofNullable(orders.get(id));
    }
}
```

Spring discovers `@Service` and creates this bean. Its single constructor receives a configuration value; the default is `accepted`. The concurrent map supports concurrent basic reads/writes in this toy application; it is not durable storage or a substitute for a database transaction.

### Step 4: expose two HTTP operations

Create `src\main\java\example\orders\OrderController.java`:

```java
package example.orders;

import java.net.URI;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders")
public class OrderController {
    private final OrderService service;

    public OrderController(OrderService service) {
        this.service = service;
    }

    public record CreateOrderRequest(
            @NotBlank String product,
            @Min(1) int quantity) { }

    @PostMapping
    public ResponseEntity<Order> create(@Valid @RequestBody CreateOrderRequest request) {
        Order order = service.create(request.product(), request.quantity());
        return ResponseEntity.created(URI.create("/orders/" + order.id())).body(order);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Order> find(@PathVariable("id") UUID id) {
        return ResponseEntity.of(service.find(id));
    }
}
```

The controller translates HTTP input into a service call. Constructor injection connects it to the managed service. `@Valid` triggers validation of the input record; `ResponseEntity` defines status, headers and body. `ResponseEntity.of` returns 200 when the order exists and 404 when it does not.

Keep the generated `OrdersApplication` main class in `example.orders`:

```java
package example.orders;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class OrdersApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrdersApplication.class, args);
    }
}
```

These four files all share the same package and are intended to work together.

### Step 5: run it and observe an actual request

In the generated project folder:

```powershell
.\mvnw.cmd spring-boot:run
```

Wait for the startup log indicating the application has started. Leave that terminal running and open a second PowerShell terminal:

```powershell
$order = Invoke-RestMethod -Method Post `
    -Uri "http://localhost:8080/orders" `
    -ContentType "application/json" `
    -Body '{"product":"notebook","quantity":2}'
$order
Invoke-RestMethod -Uri "http://localhost:8080/orders/$($order.id)"
```

Creation returns HTTP **201**, a `Location` header, and a body resembling:

```json
{
  "id": "generated-UUID-here",
  "product": "notebook",
  "quantity": 2,
  "status": "accepted"
}
```

The actual ID is a UUID, not the placeholder above. Use it to retrieve the same order; GET returns **200**. `Invoke-RestMethod` prints parsed response data rather than all response headers; use `Invoke-WebRequest` if you want to inspect the status and `Location` explicitly.

Now trace what happened:

```text
PowerShell sends HTTP + JSON
    → embedded web server receives the request
    → Spring MVC matches POST /orders
    → JSON converter builds CreateOrderRequest
    → validation checks product and quantity
    → controller calls the injected OrderService
    → service creates an Order and stores it in the map
    → controller selects 201 + Location + body
    → JSON converter writes the response
```

**Boot's contribution:** it configures the embedded server and supported MVC/JSON infrastructure from the selected dependencies. **Spring Core's contribution:** it discovers and wires the controller/service. **Your contribution:** endpoints, business behavior, data and storage decisions.

### Step 6: make small predictions, then try them

Stop with Ctrl+C before changing code/configuration and restarting, unless you deliberately install development restart support. Ordinary edits do not automatically rebuild the running application.

| Experiment | What to do | Expected observation and lesson |
| --- | --- | --- |
| Validate input | POST `{"product":"","quantity":0}` | 400 before the service call; validation is input handling, not database rollback |
| Unknown order | GET `/orders/00000000-0000-0000-0000-000000000000` | 404 for an ID not created in this run |
| Bad ID format | GET `/orders/not-a-uuid` | 400 because the path cannot convert to `UUID` |
| Forget registration | Remove `@Service` and restart | Startup fails: the controller needs an `OrderService`, but none is registered |
| Break the scan boundary | Move the service outside `example.orders`, updating imports | Default scanning misses it; annotation alone is insufficient |
| Restart the application | Create an order, stop, restart, GET its old ID | 404: memory was cleared; Boot does not persist your map |
| Set a property | Add `orders.initial-status=queued` to `application.properties`, then restart | New orders have status `queued`; configuration changes the existing service's input |

For the invalid POST, PowerShell reports the non-success HTTP response as an error. That is expected; inspect the HTTP status rather than relying on a particular version's error-body text.

Bring the code back to its working state after each deliberate failure. Keep the generated context test passing; it can detect broken startup wiring, but does not prove the endpoints or business rules behave correctly.

### Step 7: see configuration precedence, not just read about it

Keep `orders.initial-status=queued` in `application.properties`. Stop the application, package it and locate the actual executable JAR:

```powershell
.\mvnw.cmd package
Get-ChildItem .\target\*.jar
```

Run the generated JAR, substituting its actual name:

```powershell
java -jar .\target\orders-0.0.1-SNAPSHOT.jar --orders.initial-status=review
```

Create another order. Its status is **review**, because the CLI overrides the packaged property. Launch without that CLI setting and it becomes **queued** again.

This is the concrete meaning of precedence: you did not change the constructor or service implementation, but a different property source supplied its value. Use `@ConfigurationProperties` from section 4 once several settings belong together.

### Step 8: inspect the running process with Actuator

With the generated Actuator dependency, try:

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/actuator/health"
```

Expect health status `UP` for this working toy application. This does not prove an order was saved correctly; it reports the configured health indicators.

For local learning only, add these settings and restart:

```properties
management.endpoints.web.exposure.include=health,beans,conditions
```

Inspect `/actuator/beans` to find the service/controller definitions and `/actuator/conditions` to see configuration matches. These endpoints can expose internal details; do not copy this unauthenticated diagnostic setup into production. Remove the extra exposure after the exercise.

**Recall:** the HTTP endpoint shows application behavior; `beans` shows container composition; `conditions` explains conditional configuration choices.

### Step 9: add complexity only when you can explain the current flow

Do not introduce everything at once:

| Next exercise | Concrete question it answers |
| --- | --- |
| Add a service unit test with a chosen initial status | Can I verify behavior without starting Boot? |
| Add an MVC slice test | Do routing, JSON and invalid-input responses match the contract? |
| Replace the map with a database/repository | Why does data survive restart, and where does a transaction begin? |
| Add an event after accepting an order | Is the listener synchronous, and what happens if it fails? |
| Make that listener async with a bounded executor | What changes about timing, errors and thread-bound context? |
| Add a simulated delivery failure | How do timeout, retries and supported failure responses interact? |
| Package and shut down during a request | What do readiness and graceful shutdown actually protect? |

This map deliberately does not support durable transactions, compensation, stock checks, security or idempotent order creation. Those are later requirements, not guarantees Boot secretly supplies.

**First milestone:** explain one POST from terminal to response, identify the two managed beans, change the configured status, and explain why a restart loses orders. Once you can do that, sections 1-9 become descriptions of behavior you have actually observed.

## Relevance and original-topic coverage

| PDF pages | Original coverage | Assessment |
|---|---|---|
| 1 | Executable archives, launchers, WAR initialization | Still useful; launcher package names have changed. Lower priority than auto-configuration. |
| 1-2 | Lazy initialization, runners, properties, conditions | High value; configuration precedence and readiness need fuller explanations. |
| 2-3 | Actuator, logging, JSON | High value; the endpoint table contains wrong descriptions and legacy names. |
| 3-4 | Images, Boot vs. Cloud, Cloud project catalog | Useful architecture context; names and project status must be checked rather than memorized. |

## 1. Boot's role and auto-configuration

Spring Framework supplies the container, web, data-access and other building blocks. Boot supplies conventions, dependency management, conditional auto-configuration, startup integration, and production tooling. Boot is not a replacement container, and it does not require microservices.

`@SpringBootApplication` combines `@SpringBootConfiguration`, `@EnableAutoConfiguration`, and `@ComponentScan`. The PDF's suggestion to use only the last two loses the explicit configuration role; use a configuration class as well when decomposing it.

**Added: explain the mechanism, not just the annotation.**

1. Boot imports registered auto-configuration candidates.
2. Conditions select configurations based on the classpath, environment, existing beans and application type.
3. Selected configurations contribute bean definitions.
4. Many defaults back off when an application supplies its own bean, usually through `@ConditionalOnMissingBean`.
5. The normal Spring container creates and wires the resulting beans.

A starter primarily assembles dependencies. It is not the mechanism that scans every dependency for components. Dependency management aligns compatible versions; it does not make arbitrary version overrides safe.

For current custom auto-configurations, know `@AutoConfiguration` and the registration resource `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`. Do not use a remembered `spring.factories` recipe for auto-configuration registration on modern Boot without checking the target version; that resource still has other uses.

`@ConditionalOnClass`, `@ConditionalOnBean`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`, and web-application conditions are worth knowing. Auto-configuration `before`/`after` ordering orders bean definitions, not bean instantiation; dependencies determine instantiation order.

For debugging, inspect the condition evaluation report (`--debug` or the secured `conditions` Actuator endpoint), the classpath, and the beans already present.

### Sample: the application entry point and scan boundary

```java
package example.orders;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class OrdersApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrdersApplication.class, args);
    }
}
```

Place services under `example.orders` or its subpackages. A service in `example.delivery` is outside the default component-scan boundary; move it beneath the root, import it, or configure scanning explicitly. Auto-configuration discovery is separate from your application component scan.

**Recall:** starter = dependencies; auto-configuration = conditional recipes; container = actual objects.

### Sample: a default that backs off

Imagine a reusable delivery library supplying this auto-configuration:

```java
@AutoConfiguration
class DeliveryAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean(DeliveryClient.class)
    @ConditionalOnProperty(
            prefix = "delivery", name = "enabled",
            havingValue = "true", matchIfMissing = true)
    DeliveryClient deliveryClient() {
        return new DefaultDeliveryClient();
    }
}
```

Register its fully qualified class name in the library resource:

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports

example.delivery.DeliveryAutoConfiguration
```

The resource contains the class name, not the path shown above. Do not also component-scan this auto-configuration into the consumer; let Boot import it as auto-configuration.

If the application supplies its own client, the default backs off:

```java
@Configuration(proxyBeanMethods = false)
class DeliveryConfig {
    @Bean
    DeliveryClient deliveryClient() {
        return new CompanyDeliveryClient();
    }
}
```

If `delivery.enabled=false`, the library default is not registered. This property does not disable the application's custom bean; its condition applies only to the default factory method. Any required consumer still needs a client or must be conditional too.

**Scenario:** "I added a bean and Boot stopped creating its default." Usually this is intended back-off, not broken scanning. Inspect the condition report to see the exact reason.

## 2. Executable JARs, WARs and containers

Boot's executable archive preserves dependency JARs rather than flattening all their classes into one shaded archive.

```text
application.jar
  META-INF/MANIFEST.MF
  org/springframework/boot/loader/...
  BOOT-INF/classes/    application classes and resources
  BOOT-INF/lib/        dependency JARs
```

The launcher sets up nested-archive loading and invokes the application's main class. A modern manifest uses `org.springframework.boot.loader.launch.JarLauncher` as `Main-Class`, and the application class as `Start-Class`. The PDF's `org.springframework.boot.loader.JarLauncher` is historical. Let the Boot build plugin generate the archive rather than manually editing its manifest.

`JarLauncher`, `WarLauncher`, and `PropertiesLauncher` serve different archive/loading arrangements. `classpath.idx` describes classpath ordering; `layers.idx` describes image layers for supported archives. Layering helps reuse unchanged dependencies between image builds; it is not a runtime isolation boundary.

An executable JAR normally uses `SpringApplication.run`. A traditional WAR can use `SpringBootServletInitializer.configure` to integrate with an external Servlet container. `@SpringBootApplication` and `SpringBootServletInitializer` are complementary, not alternatives.

Container images can be built with a Dockerfile or Cloud Native Buildpacks. **Added:** discuss non-root execution, image patching, resource limits, reproducible builds, graceful shutdown, health probes and secret injection. Shipping a container does not itself make an application cloud-native.

### Sample: build, launch, and distinguish JAR from WAR

For a Maven project with the Boot plugin configured to repackage:

```powershell
.\mvnw.cmd package
java -jar .\target\orders.jar --server.port=8081
```

Replace `orders.jar` with the actual artifact name. A plain Maven JAR without repackaging does not necessarily contain dependencies or an executable Boot launcher.

For external Servlet-container deployment:

```java
@SpringBootApplication
public class OrdersApplication extends SpringBootServletInitializer {
    @Override
    protected SpringApplicationBuilder configure(
            SpringApplicationBuilder builder) {
        return builder.sources(OrdersApplication.class);
    }

    public static void main(String[] args) {
        SpringApplication.run(OrdersApplication.class, args);
    }
}
```

This also requires WAR packaging and the appropriate provided Servlet-container dependency. Confirm Servlet/Jakarta compatibility with the target container; a reactive WebFlux application is not a traditional Servlet WAR deployment.

With the Maven plugin and a compatible build environment, `.\mvnw.cmd spring-boot:build-image` invokes the Buildpacks path and generally needs access to a container daemon. The executable JAR is a Java artifact; the container image packages it with runtime layers; neither implies a native executable.

**Scenario:** dependencies rarely change but application code changes daily. Layering lets the image builder reuse dependency layers instead of rebuilding every byte. It does not isolate dependency classes from application classes at runtime.

## 3. Startup, runners and lazy initialization

`ApplicationRunner` receives parsed `ApplicationArguments`; `CommandLineRunner` receives the raw string arguments. Both run during Boot startup before `SpringApplication.run` completes. Order multiple runners deliberately.

The PDF's "before it starts accepting traffic" needs a qualification: the server may already be listening. Readiness-based routing should keep traffic away until startup work completes; a runner is not a universal network barrier.

`spring.main.lazy-initialization=true` delays creation of many beans. Benefits: less startup work. Costs: delayed configuration failures, first-request latency, and memory requirements becoming apparent later. `@Lazy(false)` can opt particular beans out. A lazy bean required by an eager bean may still be created at startup.

Prefer short initialization callbacks. Put coordinated startup work at an appropriate later lifecycle stage, and avoid unbounded calls to remote services during startup.

### Sample: parsed startup arguments

```java
@Component
class StartupOptions implements ApplicationRunner {
    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(StartupOptions.class);

    @Override
    public void run(ApplicationArguments args) {
        log.info("Verification requested: {}", args.containsOption("verify"));
        log.info("Positional argument count: {}", args.getNonOptionArgs().size());
    }
}
```

For `java -jar orders.jar --verify input.csv`, the parsed option is `verify` and the positional argument is `input.csv`. `CommandLineRunner` instead receives the raw argument strings. `@Order` can order runners; it is not a general dependency-management mechanism.

**Scenario:** a runner is still loading essential local data while the port is open. Readiness routing should withhold traffic until startup completes. A thrown runner exception fails startup; a never-ending runner can keep readiness from reaching its normal accepting state. Do not hide failure or wait indefinitely for remote infrastructure.

```properties
spring.main.lazy-initialization=true
```

With laziness, a missing configuration value may surface only when an endpoint first uses its service. Keep critical validation eager where appropriate and measure first-use latency, not just startup time.

## 4. Externalized configuration

The PDF lists only a subset of configuration locations. Modern Boot uses the **Config Data** model as well as system properties, environment variables, command-line arguments and test sources.

A useful ordinary-runtime subset, from lower to higher precedence, is:

1. Packaged application configuration.
2. Packaged profile-specific configuration.
3. External application configuration.
4. External profile-specific configuration.
5. Environment variables.
6. JVM system properties.
7. Command-line properties.

This is not the complete precedence table; imports, custom locations, Servlet/JNDI sources and test overrides matter. Use the reference when an exact precedence question arises.

- `spring.config.name` changes the configuration name.
- `spring.config.location` replaces default locations; `spring.config.additional-location` augments them.
- `spring.config.import` imports additional configuration, including supported config-tree arrangements.
- Profiles select configuration; they are not security boundaries.
- `${...}` placeholders resolve values from the environment.
- Prefer `@ConfigurationProperties` for grouped, typed configuration; register it through scanning or `@EnableConfigurationProperties`, and validate required values. Use `@Value` for simple isolated values.
- Relaxed binding is especially relevant for environment-variable names and configuration properties.
- Keep credentials out of Git and logs; use an appropriate external secret source.

**Interview scenario:** a timeout differs between local and production runs. Identify its winning property source before changing the default. Do not "fix" precedence by copying the same value into every file.

### Sample: typed, validated delivery settings

```yaml
# application.yml
delivery:
  base-url: https://delivery.example.invalid
  timeout: 2s
  max-attempts: 3
```

```java
import java.net.URI;
import java.time.Duration;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "delivery")
public record DeliveryProperties(
        @NotNull URI baseUrl,
        @NotNull Duration timeout,
        @Min(1) int maxAttempts) {
    public DeliveryProperties {
        if (timeout != null && (timeout.isZero() || timeout.isNegative())) {
            throw new IllegalArgumentException("delivery.timeout must be positive");
        }
    }
}
```

Register it with `@EnableConfigurationProperties(DeliveryProperties.class)` on a configuration class or with `@ConfigurationPropertiesScan`. Records use constructor binding in modern Boot without adding `@ConstructorBinding` to this single constructor. Validation requires a Bean Validation implementation; URI conversion alone does not validate allowed hosts, schemes, or connectivity.

Inject `DeliveryProperties` into the client instead of scattering individual `@Value` fields throughout the code. `2s` binds to a `Duration`, while `max-attempts` binds to `maxAttempts`. Missing required values or invalid settings fail startup when this bean is created.

### Scenario: which timeout wins?

Suppose the packaged YAML specifies `2s`, but you launch:

```powershell
$env:DELIVERY_TIMEOUT = "5s"
java -Ddelivery.timeout=4s -jar .\orders.jar --delivery.timeout=1s
```

In the ordinary configuration setup shown, command-line `1s` wins over JVM `4s`, environment `5s`, and packaged `2s`. Remove the command-line override and `4s` wins. These are independent sources, not a merge that chooses the largest timeout.

Environment-variable binding removes hyphens and replaces dots with underscores: `delivery.max-attempts` becomes `DELIVERY_MAXATTEMPTS`. Prefer the documented binding rules over guessing variable names.

For optional extra files:

```properties
spring.config.import=optional:file:./delivery-local.properties
```

`optional:` permits that location to be absent; it does not make invalid contents acceptable. Use `spring.config.additional-location` to retain default locations, and `spring.config.location` only when replacement is intended. Avoid making a mandatory production secret source optional merely to get startup to succeed.

**Recall:** presence/profile selects configuration; precedence selects the winning value; binding creates typed settings; validation rejects invalid settings.

## 5. Actuator and observability

Actuator offers production endpoints and monitoring integration, but exposure, access and security still require configuration. The PDF's "without coding and configuration" overstates the default.

With the usual base path, URLs are `/actuator/{id}`, not bare `/health` or `/env`. Endpoint availability, web exposure and authorization are separate decisions.

| Endpoint ID | Meaning / correction |
|---|---|
| `health` | Health status; details are controlled separately. Do not equate one aggregate status with readiness. |
| `conditions` | Auto-configuration matches and non-matches. This was incorrectly attributed to `auditevents`. |
| `auditevents` | Audit events, with an appropriate audit repository. |
| `beans` | Bean inventory. |
| `env`, `configprops` | Configuration diagnostics; treat these as sensitive even with sanitization. |
| `metrics` | Available metric names and measurements; export requires the corresponding registry/setup. |
| `threaddump` | Thread dump; the PDF's `dump` name is legacy. |
| `httpexchanges` | Recorded HTTP exchanges when an `HttpExchangeRepository` is available; the old `trace` endpoint is not distributed tracing. |

**Added:** distinguish metrics, logs and distributed traces. Micrometer observations can support metrics and tracing; instrumentation, propagation and export all need attention. Keep tags low-cardinality and do not include tokens, raw prompts or personal data in telemetry.

Liveness answers whether restarting an instance may help; readiness answers whether it should receive traffic. A downstream service outage should not automatically trigger endless restarts of healthy application processes.

### Sample: narrowly expose health and enable probes

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health
  endpoint:
    health:
      show-details: never
      probes:
        enabled: true
```

With Actuator and supported web infrastructure, health probes are available at `/actuator/health/liveness` and `/actuator/health/readiness`. Enabling probes explicitly makes the sample independent of automatic Kubernetes detection. Exposure does not itself define authentication or network access; configure those separately.

```text
Liveness:  Is this instance unhealthy in a way restarting may fix?
Readiness: Should requests be routed to this instance now?
```

**Scenario:** the shared database goes down. Including it in liveness can restart every application instance without fixing the database. Readiness inclusion is a separate policy decision: remove instances only when they cannot serve useful traffic. Boot's readiness group does not automatically include every external health indicator.

If Actuator runs on a separate management port, its success does not prove the main application port works. Consider supported additional probe paths on the main port or a check that verifies the actual traffic path.

### Sample: a low-cardinality business metric

```java
@Service
class OrderMetrics {
    private final io.micrometer.core.instrument.Counter accepted;

    OrderMetrics(io.micrometer.core.instrument.MeterRegistry registry) {
        accepted = io.micrometer.core.instrument.Counter.builder("orders.accepted")
                .description("Orders accepted for processing")
                .register(registry);
    }

    public void recordAccepted() {
        accepted.increment();
    }
}
```

Call this only at the point represented by "accepted"; a counter does not enforce successful persistence. Do not attach `orderId` as a metric tag: every unique ID would create another time series. Put safe correlation fields in logs or traces where appropriate instead.

`/actuator/metrics` supports diagnostics when exposed and authorized. Prometheus scraping additionally requires the Prometheus registry and endpoint exposure; tracing additionally requires instrumentation, propagation and an exporter. A meter registry is not an automatic distributed trace pipeline.

## 6. Logging and JSON

With common starters, Logback is the usual logging default. Console logging is normal; files can be configured with `logging.file.name` or `logging.file.path`.

The property prefix is `logging.level.<package>`, not the PDF's `log.level.<package>`. JVM `-D` options go **before** `-jar`; Boot `--property=value` options go after the JAR:

```text
java -Dlogging.level.org.springframework=ERROR -jar application.jar
java -jar application.jar --logging.level.org.springframework=ERROR
```

Switching to Log4j2 involves excluding the default logging starter and adding the appropriate replacement. Avoid competing logging implementations or incompatible bridges.

The PDF's JSON-library list is not a timeless compatibility promise. Jackson remains central; Boot 4 / Framework 7 introduce Jackson 3 as the default path and deprecated Jackson 2 support. Jackson 3's main packages differ, while Jackson annotations retain their established package. Check serializer modules and customizers during migration.

### Sample: logging and JSON without leaking internals

```yaml
logging:
  level:
    root: INFO
    example.orders: DEBUG
```

```java
private static final org.slf4j.Logger log =
        org.slf4j.LoggerFactory.getLogger(OrderService.class);

// In an operation, using an approved non-sensitive correlation value:
log.debug("Order accepted; correlationId={}", correlationId);
```

Use parameterized logging; do not log credentials, authorization headers, or entire request bodies. Broad production DEBUG logging can expose sensitive data and increase overhead.

With supported MVC/JSON dependencies, Boot configures HTTP JSON conversion:

```java
record OrderResponse(String status) { }

@RestController
class OrderStatusController {
    @GetMapping("/order-status")
    OrderResponse status() {
        return new OrderResponse("accepted");
    }
}
```

The response is JSON such as `{"status":"accepted"}`; the controller does not manually create an object mapper. Returning a DTO rather than a persistence entity keeps the public contract explicit. Custom serialization modules must match your Jackson generation; do not copy a Jackson 2 customizer into Boot 4 without checking its supported migration path.

## 7. Boot vs. Cloud

Boot simplifies constructing and running an application. Spring Cloud adds integrations for distributed-system patterns. Cloud is not required merely because an application runs on Kubernetes.

| Original catalog topic | Updated study guidance |
|---|---|
| Config | Centralized configuration; a server-side change is not automatically applied to every running bean. Refresh/restart and consistency must be designed. |
| Netflix / Eureka | Understand discovery; Kubernetes or another platform may supply it instead. Do not revive retired Netflix components from old tutorials. |
| Stream | Broker integration; understand delivery guarantees, ordering, retries and idempotent consumers. |
| "Spring Cloud Security" | Do not treat this historical umbrella as the default security implementation. Study current Spring Security OAuth2 client/resource-server support. |
| Gateway | Routing, filters and edge policies; business authorization still belongs downstream. |
| OpenFeign | Useful in existing systems; also learn Spring HTTP Service Clients and check the chosen release train's guidance. |
| "Spring Cloud Secure Vault" | The actual project name is **Spring Cloud Vault**. |
| Function | Functional application adapters, including serverless deployment options. |
| Circuit Breaker | An abstraction for supported implementations; separate circuit breaking from retry and timeout. |

Use the Spring Cloud compatibility matrix/release train for the selected Boot generation; do not independently select the newest version of every Cloud module.

### Scenario: an order service calls a delivery service

| Need | Possible solution | What it does not solve |
| --- | --- | --- |
| Locate delivery instances | Platform DNS/discovery or a discovery service | Authorization or network timeouts |
| Stop waiting indefinitely | Client connect/read/response timeouts and an overall deadline | Safe retries |
| Retry a transient failure | Limited retries with backoff/jitter and an idempotency strategy | Persistent outage or unlimited capacity |
| Avoid repeated calls to a failing dependency | Circuit breaker | Repairing the dependency |
| Limit concurrent calls | Bulkhead/bounded concurrency and pool limits | Durable buffering |
| Reliably hand off order events | Broker integration plus outbox where DB atomicity is needed | Automatic exactly-once business effects |

Cloud supplies integrations for some of these; adding a dependency does not automatically establish an operational policy. A request timeout can leave a remote operation running, so retrying order submission without idempotency may create duplicates. A fallback must express a real supported outcome, not falsely report successful delivery.

## 8. Added priorities for 2026

**Must know:** auto-configuration/back-off, dependency alignment, configuration binding/precedence, tests, Actuator access and readiness.

**Next:** `@SpringBootTest` versus focused slices, Testcontainers and `@ServiceConnection`, HTTP client configuration, graceful shutdown, Micrometer/OpenTelemetry, connection pools and bounded executors.

**Version-aware:** Boot 4's modularized artifacts and test support, HTTP Service Client auto-configuration, Framework 7 API versioning, Jackson 3 migration, AOT/native-image trade-offs. Boot 3.x / Framework 6.x remain important for existing-system interviews; latest documentation is not a recipe for every older application.

Virtual threads require a suitable Java runtime (not merely Boot's minimum Java version). They can help blocking-I/O concurrency but do not remove database connection limits, CPU limits or remote-service capacity.

**AI-age application questions:** how to externalize model configuration, choose compatible Spring AI/Boot versions, bound provider calls, export safe telemetry and run evaluations. Know `ChatClient`, structured output, tool calling, RAG and MCP at a conceptual level when the role requires them. AI-generated code still needs configuration, dependency, contract and security review; framework fluency remains necessary.

### Sample: graceful shutdown is a routing and lifecycle problem

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

On normal shutdown, supported embedded servers stop accepting new work and allow active requests time to complete according to their implementation. This is not protection against a process crash. Coordinate traffic removal, propagation delays, termination grace periods and application cleanup with the deployment platform.

**Scenario:** the platform forcibly terminates the process after 10 seconds, but the application allows 30 seconds. The application cannot finish its advertised wait. Size platform budgets for the entire shutdown process, including multiple phases and custom tasks.

### Sample: choose the smallest useful test

The following web slice explicitly uses **Boot 3.x imports**; Boot 4 modularizes test support and moves some test annotations. Select the corresponding module/import for your release. The controller is the `OrderStatusController` from section 6.

```java
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(OrderStatusController.class)
class OrderStatusControllerTest {
    @Autowired
    MockMvc mvc;

    @Test
    void returnsAcceptedStatus() throws Exception {
        mvc.perform(get("/order-status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("accepted"));
    }
}
```

This assumes a sample without security restrictions. If Security is present, configure authentication and test the intended rules rather than disabling filters just to get a green test. A slice loads selected infrastructure, not every application service; provide missing collaborators explicitly.

| Test choice | What to verify |
| --- | --- |
| Plain unit test | Business rules using directly constructed objects and fakes |
| MVC slice | Routing, binding, serialization, validation and applicable web security |
| Data slice | Repository mappings/queries and database behavior |
| `@SpringBootTest` with a random port | Full application integration over a real local HTTP connection |

`@SpringBootTest` by itself does not necessarily start a real server; choose `webEnvironment = RANDOM_PORT` when that is the behavior being tested. Database fidelity matters: a passing in-memory SQL test does not prove production-database compatibility.

### Scenario: realistic database tests with service connections

With modern Boot Testcontainers support and the matching test dependencies:

```java
@Testcontainers
@SpringBootTest
class DatabaseIntegrationTest {
    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres =
            new PostgreSQLContainer<>("postgres:16-alpine");

    // Add repository/application tests using this database.
}
```

Use `org.springframework.boot.testcontainers.service.connection.ServiceConnection`, JUnit Jupiter's Testcontainers annotations, and the PostgreSQL container class for your selected Testcontainers release. Boot derives connection details for supported container types instead of requiring manual dynamic property registration.

The snippet demonstrates setup, not a completed test assertion. It requires a compatible container runtime and JDBC/database dependencies. Pin an image suitable for the actual production version, and do not substitute Docker availability for checking migrations, constraints, rollback and concurrency behavior.

## 9. Interview questions with answers and scenarios

Give the short answer first; then explain a failure mode or the relevant sample above.

### 9.1 What does Boot add to Spring?

**Answer:** conventions, dependency management, conditional auto-configuration, startup integration and operational tooling. The Spring container still creates and injects beans. Boot can run a monolith, a batch application or a microservice.

**Recall:** Spring supplies the building blocks; Boot supplies an opinionated assembly and operational starting point.

### 9.2 A custom `DataSource` was added and the default disappeared. Why?

**Answer:** a relevant auto-configuration condition can back off when it detects your bean. Confirm the condition report rather than assuming that every default is replaced the same way.

**Scenario:** your custom data source is registered but has an invalid URL. Back-off does not validate it or keep the old default as a hidden fallback; fix and verify the custom configuration.

### 9.3 What is the difference between a starter and auto-configuration?

**Answer:** the starter brings a curated dependency set; auto-configuration uses conditions to register defaults. A starter does not mean all classes in its JARs become components.

**Follow-up:** Boot-managed versions are aligned, not individually newest. A direct version override can break that alignment even when the project compiles.

### 9.4 Auto-configuration A runs before B, but A's bean initializes later. Is that wrong?

**Answer:** no. Auto-configuration ordering controls definition processing. Object creation follows dependencies, laziness and lifecycle rules.

If bean A needs bean B as a constructor or factory-method parameter, B must be available first regardless of definition order. Express real dependencies directly instead of relying on configuration ordering as a startup scheduler.

### 9.5 Why isn't my `@Service` discovered?

**Answer:** check the scan root, package placement, profiles/conditions and whether you are loading the expected context. A stereotype is metadata, not a promise that every context discovers the class.

**Scenario:** the main class is in `example.orders`, but a service is in sibling package `example.delivery`. Default application scanning does not include it. Do not broaden scanning to the entire dependency classpath as a first fix.

### 9.6 Which value wins if YAML, an environment variable and the CLI disagree?

**Answer:** the higher-precedence active property source wins. In the ordinary example in section 4, CLI beats JVM system properties, environment variables and packaged config.

Investigate the resolved property and its source using safe diagnostics. Check imports, profiles and custom locations before editing defaults. Never log an entire environment to diagnose one setting.

### 9.7 When should you use `@ConfigurationProperties` instead of `@Value`?

**Answer:** use it for related settings needing typed binding, validation and a coherent configuration API. Use `@Value` for an isolated value or a deliberate expression.

The delivery settings record groups a URI, timeout and attempt limit. Binding does not automatically prove a URL is authorized or reachable, and grouped configuration must be registered.

### 9.8 Does changing a config file reconfigure running beans automatically?

**Answer:** not generally. Startup binding creates configured objects; updating a file or central server does not automatically reconstruct them.

Choose restart/redeploy or supported refresh mechanisms deliberately. Some settings cannot safely change in place, and replicas can temporarily have different values. Profiles are not live feature flags.

### 9.9 The port is open while a runner is executing. Can traffic arrive?

**Answer:** yes. Listening and ready are different states. Boot's normal readiness progression reaches accepting traffic after runners complete, but clients bypassing readiness-aware routing can connect earlier.

Use platform routing/probes rather than treating a runner as a network barrier. Ensure startup work has bounded duration and explicit failure behavior.

### 9.10 A lazy application starts quickly but fails on its first request. Why?

**Answer:** laziness deferred creation and therefore some validation/connection work. Startup became faster, but first-use latency and failures moved into traffic handling.

Keep essential configuration eager where appropriate and exercise critical routes before promotion. Lazy initialization does not remove the application's eventual memory requirement.

### 9.11 `/actuator/conditions` is missing or forbidden. What do you check?

**Answer:** dependency/endpoint availability, web exposure, base path/port, endpoint access settings and security authorization are separate layers.

A 404 can mean not exposed, a wrong location, or endpoint unavailability; a 401/403 can indicate security policy. Do not solve either by publicly exposing all endpoints. Use startup `--debug` when that is a safer diagnostic path.

### 9.12 How do liveness and readiness differ?

**Answer:** liveness helps decide whether to restart; readiness helps decide whether to route traffic. Shared downstream outages usually should not cause mass liveness restarts.

**Scenario:** the database is down but the process is healthy. Decide whether useful endpoints remain available and whether DB health belongs in readiness. A dedicated management-port check may not cover the main traffic path.

### 9.13 What is the difference between metrics, logs and traces?

**Answer:** metrics summarize trends, logs record individual events, and traces connect operations across boundaries.

For slow orders, metrics reveal latency trends; a trace locates the slow database/provider span; logs explain a particular error. Avoid high-cardinality metric IDs, and configure trace propagation/export explicitly.

### 9.14 An HTTP dependency repeatedly fails. How do you protect the application?

**Answer:** start with timeouts and an overall deadline, then use bounded concurrency, safe limited retries, and circuit breaking where appropriate.

With a 3-second deadline, three attempts each allowed 2 seconds plus backoff do not fit. Concurrent retries can exhaust connection pools and amplify an outage. Use idempotency for retryable writes and monitor rejection, timeout and pool-wait behavior.

### 9.15 Is `@SpringBootTest` always the right test?

**Answer:** no. Use a unit test for logic and a slice for focused infrastructure; use full-context integration when interactions across configuration matter.

For HTTP status/JSON in section 6, an MVC slice is enough. For end-to-end application/database wiring, a full context with a realistic database can be appropriate. Mocking every dependency in a full-context test may hide the integration it supposedly verifies.

### 9.16 What do Testcontainers and `@ServiceConnection` solve?

**Answer:** Testcontainers supplies temporary real services; service connections supply supported connection details to Boot.

They do not write assertions, guarantee production fidelity, or eliminate test isolation requirements. Match database versions and test migrations/constraints rather than merely checking that the container starts.

### 9.17 Does enabling virtual threads remove resource limits?

**Answer:** no. It can improve scalability for blocking I/O on a supported Java runtime, but database connections, remote capacity, CPU and memory remain finite.

```properties
spring.threads.virtual.enabled=true
```

Use only with a supported Boot/Java combination. This configures supported Boot integrations, not every custom executor. Ten thousand concurrent operations waiting for a ten-connection pool still need concurrency and deadline policies.

### 9.18 Does graceful shutdown guarantee no lost work?

**Answer:** no. It coordinates normal termination within configured budgets; it cannot protect against crashes or forced termination.

Coordinate routing removal and platform grace periods, close resources, and use durable storage/messaging for work that must survive process failure. An in-memory async queue is not durable merely because shutdown waits for it.

### 9.19 Is Spring Cloud required on Kubernetes?

**Answer:** no. Choose it for specific integration needs, not because of the hosting platform. Kubernetes may already provide discovery/configuration capabilities, while broker integrations or circuit-breaker abstractions may still be useful.

Always match the Cloud release train to the Boot generation.

### 9.20 How are executable JARs, container images and native images different?

**Answer:** an executable JAR contains Java application/dependency artifacts and needs a JVM; a container image packages a process environment; a native image compiles an executable for a target platform.

A container can run either a JVM JAR or a native executable. Native builds need Spring AOT-compatible configuration and reachability metadata; they are not simply smaller JARs. See [Core's AOT explanation](Spring-Core-Interview-Notes.md#1010-what-changes-with-aotnative-image-constraints).

### 9.21 What should you investigate during Boot 3-to-4 migration?

**Answer:** dependency modules, test modules/imports, Framework/Jakarta baselines, JSON configuration and deprecated APIs, using the actual migration guide for the selected versions.

Compile success alone does not prove serialization, security defaults or production diagnostics are unchanged. Run contract and integration checks against observable behavior rather than blindly replacing package names.

### 9.22 How would you integrate an AI provider into this Boot application?

**Answer:** bind and validate provider configuration, choose compatible libraries, bound calls and concurrency, and isolate provider behavior behind a service interface.

Model output is untrusted data, not authorization to perform a business action. Keep secrets and personal data out of telemetry, evaluate representative failure cases, and never convert a provider failure into a false "order accepted" response.

## Change references

**Version change** means APIs/defaults changed; **correction** means the original explanation was already incomplete/wrong; **guidance** means a recommended approach rather than a removal. Locations refer to PDF pages. These sources were checked for this October 31, 2026 review; current reference links can subsequently advance.

| Original location / claim | Category and correction | Official evidence |
|---|---|---|
| p. 1: `org.springframework.boot.loader.JarLauncher` | Version change: current launcher lives in `.loader.launch`; preserve the Main-Class/Start-Class distinction. | [Executable archive launcher and manifest](https://docs.spring.io/spring-boot/specification/executable-jar/launching.html) |
| p. 1: replace SpringBootApplication with only two annotations | Correction: include its configuration role as well as scanning/auto-configuration. | [Using SpringBootApplication](https://docs.spring.io/spring-boot/reference/using/using-the-springbootapplication-annotation.html) |
| pp. 1-2: runners before traffic; lazy startup | Qualification: readiness controls routing; laziness can defer failures and first-use work. | [Boot application startup](https://docs.spring.io/spring-boot/reference/features/spring-application.html) |
| p. 2: four property-file locations as full precedence | Version-aware expansion: modern Config Data plus environment/system/CLI/test sources; distinguish replace vs. additional locations. | [Externalized configuration and source order](https://docs.spring.io/spring-boot/reference/features/external-config.html) |
| p. 2: condition and auto-configuration order notes | Expansion: current imports resource, conditional back-off, and definition order versus creation order. | [Creating auto-configuration](https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html) |
| p. 2: `auditevents` reports auto-configuration | Correction: that is `conditions`; `auditevents` reports audit events. | [Conditions endpoint](https://docs.spring.io/spring-boot/api/rest/actuator/conditions.html) and [Audit events endpoint](https://docs.spring.io/spring-boot/api/rest/actuator/auditevents.html) |
| p. 2: `/trace`, `/dump`, no endpoint configuration needed | Version-aware correction: `httpexchanges` and `threaddump`; availability/exposure/access are separate. | [HTTP exchanges](https://docs.spring.io/spring-boot/api/rest/actuator/httpexchanges.html), [thread dump](https://docs.spring.io/spring-boot/api/rest/actuator/threaddump.html), [Actuator endpoints](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html) |
| p. 3: `log.level` and `-D` after `-jar` | Correction, not a new framework change: use `logging.level`; JVM option placement differs from Boot application arguments. | [Boot logging](https://docs.spring.io/spring-boot/reference/features/logging.html) and [command-line properties](https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.command-line-args) |
| p. 3: historical JSON-library defaults | Version change: Boot 4 migration includes Jackson 3 and deprecated Jackson 2 support; check customizers/dependencies. | [Boot 4.0 migration guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide) |
| pp. 3-4: Cloud catalog as a fixed list | Guidance/correction: use current projects and compatibility; actual name is Spring Cloud Vault. | [Spring Cloud](https://spring.io/projects/spring-cloud) and [Spring Cloud Vault](https://spring.io/projects/spring-cloud-vault) |
| New modular artifacts and test support absent | Version change/addition: Boot 4 splits technology-specific main/test support; old dependencies/imports may need migration. | [Boot 4.0 migration: module dependencies](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide#module-dependencies) |
| HTTP client groups / telemetry additions absent | Addition: current Boot 4 auto-configuration and observability capabilities. | [Boot 4.0 release notes](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Release-Notes) |

The table does not invent a first-change version where the linked reference only documents current behavior.

## Official references

- [Boot auto-configuration development](https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html)
- [Externalized configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html)
- [Executable archive launchers](https://docs.spring.io/spring-boot/specification/executable-jar/launching.html)
- [Actuator](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)
- [Boot 4.0 release notes](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Release-Notes)
- [Spring Cloud projects and compatibility](https://spring.io/projects/spring-cloud)
- [Spring AI reference](https://docs.spring.io/spring-ai/reference/index.html)

Reference links can move with current releases. Select the version matching the target application before copying imports or configuration.
