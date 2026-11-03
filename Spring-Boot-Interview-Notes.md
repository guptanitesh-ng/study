# Spring Boot: Interview Notes

Reviewed: October 31, 2026. Source: the four-page Spring Boot PDF, dated September 23, 2020, with later Spring Cloud material.

This is an editorial Markdown conversion, not a verbatim transcript: original topics are retained in condensed form, outdated claims are corrected, and additions are identified. Screenshots/diagrams are not reproduced; text references to them are not a substitute for inspecting the PDF. Priorities below are study recommendations, not predictions of a particular interview.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> **Boot** -> [REST + MVC](Spring-REST-MVC-Interview-Notes.md) -> [Data](Spring-Data-Interview-Notes.md) -> [Security](Spring-Security-Interview-Notes.md).

## How to learn from these examples

Use this recurring scenario: **an order application** accepts orders, stores them in a database, and calls an external delivery service. Ask what Boot configures, what you override, and what happens when a dependency fails.

Examples are independent teaching snippets, not one combined application. Imports and domain implementations are omitted unless important. Use the Boot-managed dependency set for your selected release. Web, validation, Actuator, database and test examples require their corresponding dependencies; annotations alone do not install infrastructure. Where Boot 3 and 4 differ, examples identify the boundary instead of assuming interchangeable imports.

## Start with your own applications: make the abstractions concrete

Use your existing projects to connect the interview concepts to familiar code.

Source snapshot inspected: November 1, 2026. Paths below are relative to each project root. These are source-backed explanations, not a claim that the applications were launched or their external services verified.

| Your project | What it actually uses | Best learning role |
| --- | --- | --- |
| `C:\Users\guptanitesh\Downloads\dairy-order-processor` | Spring Boot 3.5.16, Java 21; `spring-boot-starter`, not the web starter | Primary example for Boot startup, scanning, bean wiring, properties and command-line execution |
| `C:\Users\guptanitesh\Downloads\quiz-generator` | Quarkus 3.39.4, Java 21; backend in `backend` | Compare HTTP entry points and dependency injection without treating CDI/Jakarta REST as Spring |

### 1. Trace what starts the dairy application

Open `src\main\java\com\example\dairyorderprocessor\DairyOrderProcessorApplication.java`.

```java
@SpringBootApplication
public class DairyOrderProcessorApplication {
    public static void main(String[] args) {
        SpringApplication.run(DairyOrderProcessorApplication.class, args);
    }
}
```

`main` is ordinary Java. `SpringApplication.run` starts the Boot application and creates its Spring application context. `@SpringBootApplication` supplies configuration, auto-configuration and component scanning. Because this class is in `com.example.dairyorderprocessor`, its default component scan covers subpackages such as `config`, `pipeline` and `extraction`.

**Concrete question:** who creates `PipelineRunner`? You do not call `new PipelineRunner(...)` here. Spring discovers its `@Component` annotation and supplies the dependencies needed to construct it.

This application is a command-line pipeline, not an MVC server: its POM has no web starter. Boot does not mean "start Tomcat" or "expose a REST API" in every project.

### 2. Separate startup wiring from business execution

Read these files under `src\main\java\com\example\dairyorderprocessor` in this order:

| File | What to notice |
| --- | --- |
| `pipeline\PipelineRunner.java` | `@Component`, a constructor accepting `OrderPipeline`, and `implements CommandLineRunner` |
| `pipeline\OrderPipeline.java` | Constructor receives collaborators; `run()` coordinates the actual work |
| `config\AppConfig.java` | `@Bean` methods register objects that scanning alone would not create |
| `config\DairyProperties.java` | `@ConfigurationProperties(prefix = "dairy")` represents external settings |

After the context is refreshed, Boot invokes `PipelineRunner.run(String... args)`. That method calls `pipeline.run()`, logs completion, and logs/rethrows failures. It is not an HTTP handler, and it is not Spring constructing a new pipeline for every stage.

The business path in `OrderPipeline.run()` is:

```text
read chat file -> parse messages -> resolve month / check coverage / filter scope
              -> extract intents / optionally compare with regex
              -> resolve events / carry opening state -> schedule deliveries
              -> aggregate report -> write files and print summary
```

Spring assembles the collaborators; your Java code defines this sequence. Boot does not infer dairy rules, delivery schedules or report contents.

### 3. Watch one property choose one implementation

In `AppConfig`, `@EnableConfigurationProperties` registers `DairyProperties` and `AzureOpenAiProperties` for binding. The `intentExtractor(...)` bean factory receives those bound objects, a `RegexIntentExtractor` and an `ExtractionCache`.

| Configuration seen by the factory | Returned implementation |
| --- | --- |
| `dairy.extractor=regex` | The injected regex extractor |
| `dairy.extractor=llm`, but Azure configuration is missing | Logs an error and returns the regex extractor |
| `dairy.extractor=llm`, with Azure configuration present | Builds the model/AI service and returns a new `LlmIntentExtractor` |

This is **your explicit factory logic**, not Boot auto-configuration and not `@ConditionalOnProperty`. Configuration being present does not prove credentials are valid or a remote request will succeed. The missing-configuration fallback is not evidence of a general fallback for every later LLM failure.

`OrderPipeline` asks for the interface `IntentExtractor`. The `@Primary` factory bean is the preferred candidate for that injection point; the separately scanned regex component is also injected by its concrete type for comparison. See the [Core guide](Spring-Core-Interview-Notes.md) for the general explanations of dependency resolution and bean scopes.

These settings are bound at startup. Editing a configuration file after the context starts does not automatically rebuild the extractor.

### 4. Find the boundary between Boot defaults and your choices

`pom.xml` uses the Boot parent for dependency/build defaults, the starter for core Boot infrastructure, and the Boot Maven plugin for packaging. Your `AppConfig.objectMapper()` explicitly creates and configures Jackson's mapper, including `JavaTimeModule`. Your `clock()` explicitly supplies a `Clock`.

Do not attribute those factory bodies to Boot: **dependency management makes libraries available; auto-configuration can supply conditional defaults; component scanning finds application components; your `@Bean` methods supply explicit objects.** These are four different mechanisms.

There is no Spring Data/JPA dependency in this POM. The pipeline reads a file and writes reports; do not invent a database repository or transaction boundary to fit a controller-service-repository diagram.

### 5. Use the quiz app as a labelled framework comparison

Open `backend\src\main\java\com\example\quiz\api\QuizResource.java` and `service\QuizGenerationService.java` beneath the same Java package directory.

`QuizResource` uses Jakarta REST `@Path("/api/quizzes")`, `@POST` and `@Path("/generate")` for `POST /api/quizzes/generate`. Its `@Inject` constructor receives `QuizGenerationService`, and `generate(...)` delegates to that service. The service uses CDI `@ApplicationScoped` and constructor injection; it also creates a `QuizRepairer` directly with `new`.

The transferable ideas are "a framework routes the request" and "a container supplies collaborators." The actual frameworks are **Quarkus REST and CDI**, not Spring MVC and Spring's bean factory.

| Quiz app concept | Spring counterpart to learn, not an exact replacement |
| --- | --- |
| Jakarta REST `@Path` / `@POST` | Spring MVC `@RestController` / request mapping annotations |
| CDI constructor `@Inject` | Spring constructor injection; a sole constructor needs no `@Autowired` |
| CDI `@ApplicationScoped` | Application-lifetime scope to compare with Spring singleton; proxy/lifecycle semantics differ |
| Quarkus extensions and BOM | Boot starters and dependency management; startup/registration mechanisms differ |

No migration or annotation replacement is needed for this study exercise.

### A focused first study session

Set source breakpoints in the dairy app at `AppConfig.intentExtractor(...)`, the `OrderPipeline` constructor, `PipelineRunner.run(...)`, and `OrderPipeline.run()`. First explain which ones assemble objects and which ones execute business work. If you later run it, use regex mode and separate input/output/cache paths: startup executes the runner, which reads input and writes reports. Do not run the ordinary context test expecting it to be side-effect-free; its `@SpringBootTest` can invoke that runner too.

For a smaller existing example, open `src\test\java\com\example\dairyorderprocessor\pipeline\TargetMonthResolverTest.java`. It constructs the resolver with a fixed clock without starting Spring. This shows why dependency injection is useful even outside a container.

## Relevance and original-topic coverage

| PDF pages | Original coverage | Assessment |
| --- | --- | --- |
| 1 | Executable archives, launchers, WAR initialization | Still useful; launcher package names have changed. Lower priority than auto-configuration. |
| 1-2 | Lazy initialization, runners, properties, conditions | High value; configuration precedence and readiness need fuller explanations. |
| 2-3 | Actuator, logging, JSON | High value; the endpoint table contains wrong descriptions and legacy names. |
| 3-4 | Images, Boot vs. Cloud, Cloud project catalog | Useful architecture context; names and project status must be checked rather than memorized. |

## 1. Boot's role and auto-configuration

**Recall:** dependencies make classes available; configuration registers bean definitions; Spring creates and injects the objects.

Spring Framework supplies the container and web/data building blocks. Boot adds dependency management, conditional defaults, startup and production tooling. Boot is not a separate container and does not require a web server or microservices.

### Application beans versus library defaults

`@SpringBootApplication` combines `@SpringBootConfiguration`, `@EnableAutoConfiguration` and `@ComponentScan`.

| Mechanism | What it does |
| --- | --- |
| Dependencies in `pom.xml` | Make library classes/resources available; do not automatically turn every class into a bean |
| Starter | Groups related dependencies; dependency management aligns their versions |
| Component scanning | Finds your application's `@Component`, `@Service` and `@Configuration` classes beneath the main class's package |
| Auto-configuration | Imports registered configurations from Boot/libraries and conditionally supplies bean definitions |

Your dairy app's `AppConfig` is ordinary scanned application configuration. It does not need an auto-configuration registration file. Classes outside the scan boundary require explicit scanning or imports.

### Conditions are registration gates

| Condition | Gate passes when... |
| --- | --- |
| `@ConditionalOnClass(ObjectMapper.class)` | The class is available on the classpath; this does not imply a mapper bean exists |
| `@ConditionalOnMissingBean(IntentExtractor.class)` | No matching bean definition is registered so far |
| `@ConditionalOnBean(IntentExtractor.class)` | A matching bean definition is registered so far |
| `@ConditionalOnProperty(prefix = "dairy", name = "enabled", havingValue = "true")` | `dairy.enabled=true`; absent or false does not match unless configured otherwise |
| `@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)` | The context is a servlet web application, not a non-web command-line application |

On a configuration class, conditions gate that configuration and its bean definitions. On an individual `@Bean` method, they gate that bean definition. Multiple conditions on the same element must all pass.

**Registration is not instantiation.** A passing condition allows a definition to be registered; Spring later creates the object according to scope, laziness and dependencies. Conditions are not rechecked on every business call.

### One example to remember: a reusable extractor library

Imagine extracting dairy logic into a normal library JAR, rather than reusing the executable app. The following is proposed library wiring, not the current app's source. Imports and the hypothetical consumer implementation are omitted. Keep the reusable regex class free of component registration for this example, so it is registered only through the conditional factory.

**Library supplies the default:**

```java
package example.dairy;

@AutoConfiguration
public class DairyExtractorAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean(IntentExtractor.class)
    IntentExtractor intentExtractor() {
        return new RegexIntentExtractor(new ProductCatalog());
    }
}
```

**Consumer can supply its own bean using ordinary configuration:**

```java
@Configuration(proxyBeanMethods = false)
class ExtractorConfig {
    @Bean
    IntentExtractor customExtractor() {
        return new CompanyIntentExtractor();
    }
}
```

Assuming the consumer configuration is discovered:

| Consumer registers an `IntentExtractor` definition? | Result |
| --- | --- |
| No | Library registers its default; Spring creates the regex extractor when needed |
| Yes | Library skips its default; the consumer's extractor is used |

Boot processes ordinary user configuration before deferred auto-configuration. The custom bean **does not need to have been instantiated** for back-off to happen. If its factory later fails, startup fails; the library does not then retry with its default.

This condition checks **type**, so `customExtractor` need not have the same name as `intentExtractor`. The consumer is not replacing an already-created object or editing a library registration file. Without the missing-bean condition, both definitions could be registered and injection could be ambiguous.

If a competing bean comes from another auto-configuration, use appropriate `before`/`after` ordering. That orders definition registration, not object construction.

### Where `AutoConfiguration.imports` fits

For automatic discovery, **the library author**, not the consumer, writes:

```text
src\main\resources\META-INF\spring\org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

The file contains configuration class names, one per line:

```text
example.dairy.DairyExtractorAutoConfiguration
```

It is packaged inside the library JAR under `META-INF/spring/...`. That slash-separated form is a JAR resource name, not a Windows filesystem command.

```text
Consumer adds dependency and enables Boot auto-configuration
    -> Boot reads the library's imports list
    -> evaluates the listed configuration's conditions
    -> registers matching bean definitions
    -> Spring creates and injects the objects
```

**The file lists recipes; the `@Bean` methods define defaults.** `@AutoConfiguration` alone does not make an arbitrary dependency class discoverable. Boot's own dependency JARs already contain its lists, which is why you normally do not write this file.

A plain library needs no such file: the consumer can construct/wire its classes or explicitly use `@Import(DairyLibraryConfig.class)`. Do not also component-scan a library's auto-configuration. Modern Boot uses this imports resource for auto-configuration registration, not the older `spring.factories` recipe; `spring.factories` still has other uses.

### Real Boot example: its default Jackson mapper backs off

The same pattern applies to Jackson in **Boot 3.x with `spring-boot-starter-web`**, where both Jackson and Spring's mapper builder are normally available.

**Boot's default factory, shortened for explanation:**

```java
@Bean
@Primary
@ConditionalOnMissingBean(ObjectMapper.class)
ObjectMapper jacksonObjectMapper(Jackson2ObjectMapperBuilder builder) {
    return builder.createXmlMapper(false).build();
}
```

**Your application's custom factory:**

```java
@Configuration(proxyBeanMethods = false)
class JsonConfig {
    @Bean
    ObjectMapper applicationMapper(Jackson2ObjectMapperBuilder builder) {
        return builder
                .featuresToEnable(SerializationFeature.INDENT_OUTPUT)
                .build();
    }
}
```

No custom mapper definition: Boot registers its default. Custom definition present: Boot skips that default factory, even though the names differ. Other Jackson configuration can still apply.

These snippets use Jackson 2 and Spring's `Jackson2ObjectMapperBuilder`; Boot 4's default Jackson 3 APIs differ. The [Boot 3.5 source](https://github.com/spring-projects/spring-boot/blob/v3.5.0/spring-boot-project/spring-boot-autoconfigure/src/main/java/org/springframework/boot/autoconfigure/jackson/JacksonAutoConfiguration.java) uses bare `@ConditionalOnMissingBean`, inferring the type from the factory's return type.

Your dairy app has a custom mapper but only the core starter. Do not assume removing that factory would produce Boot's default: its builder-class prerequisite must also be satisfied.

**To observe back-off:** start the web example with `--debug` and inspect `JacksonAutoConfiguration.JacksonObjectMapperConfiguration#jacksonObjectMapper` in the condition report. With your mapper present, it reports the existing bean as the reason the default did not match.

**Quick recall:** class available is not bean registered; bean registered is not object already created; user bean present means a well-designed missing-bean default backs off.

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

The PDF's "before it starts accepting traffic" needs a qualification: the server may already be listening. Readiness-based routing should keep traffic away until startup work completes; a runner is not a universal netw,,ork barrier.

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

### On AKS: separate URLs, no custom controller methods

**Actuator supplies both endpoints.** You do not need to write a liveness controller and a readiness controller. Behind the scenes, they are separate health groups backed by Spring Boot's `ApplicationAvailability` states.

| Endpoint | What it reports | Kubernetes action after the configured failure threshold |
| --- | --- | --- |
| `/actuator/health/liveness` | Application liveness state | Restarts the container |
| `/actuator/health/readiness` | Application readiness state | Marks the pod unready, removing it from normal Service traffic |

Boot manages the normal startup availability transitions; readiness normally reaches accepting traffic after startup runners complete. You can add health indicators or explicitly change availability state for application-specific requirements. A successful default liveness response is not proof that every business operation works.

**Your responsibility:** configure the AKS Deployment's probes to call the corresponding URLs on the pod, allow access through application security and network controls, and decide whether readiness needs additional checks. Actuator reports state; Kubernetes performs restarts and traffic-routing changes. Installing Actuator does not configure Kubernetes probes for you.

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
