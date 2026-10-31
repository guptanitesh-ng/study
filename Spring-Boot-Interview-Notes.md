# Spring Boot: Interview Notes

Reviewed: October 31, 2026. Source: the four-page Spring Boot PDF, dated September 23, 2020, with later Spring Cloud material.

This is an editorial Markdown conversion, not a verbatim transcript: original topics are retained in condensed form, outdated claims are corrected, and additions are identified. Screenshots/diagrams are not reproduced; text references to them are not a substitute for inspecting the PDF. Priorities below are study recommendations, not predictions of a particular interview.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> **Boot** -> [REST + MVC](Spring-REST-MVC-Interview-Notes.md) -> [Data](Spring-Data-Interview-Notes.md) -> [Security](Spring-Security-Interview-Notes.md).

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

## 3. Startup, runners and lazy initialization

`ApplicationRunner` receives parsed `ApplicationArguments`; `CommandLineRunner` receives the raw string arguments. Both run during Boot startup before `SpringApplication.run` completes. Order multiple runners deliberately.

The PDF's "before it starts accepting traffic" needs a qualification: the server may already be listening. Readiness-based routing should keep traffic away until startup work completes; a runner is not a universal network barrier.

`spring.main.lazy-initialization=true` delays creation of many beans. Benefits: less startup work. Costs: delayed configuration failures, first-request latency, and memory requirements becoming apparent later. `@Lazy(false)` can opt particular beans out. A lazy bean required by an eager bean may still be created at startup.

Prefer short initialization callbacks. Put coordinated startup work at an appropriate later lifecycle stage, and avoid unbounded calls to remote services during startup.

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

## 6. Logging and JSON

With common starters, Logback is the usual logging default. Console logging is normal; files can be configured with `logging.file.name` or `logging.file.path`.

The property prefix is `logging.level.<package>`, not the PDF's `log.level.<package>`. JVM `-D` options go **before** `-jar`; Boot `--property=value` options go after the JAR:

```text
java -Dlogging.level.org.springframework=ERROR -jar application.jar
java -jar application.jar --logging.level.org.springframework=ERROR
```

Switching to Log4j2 involves excluding the default logging starter and adding the appropriate replacement. Avoid competing logging implementations or incompatible bridges.

The PDF's JSON-library list is not a timeless compatibility promise. Jackson remains central; Boot 4 / Framework 7 introduce Jackson 3 as the default path and deprecated Jackson 2 support. Jackson 3's main packages differ, while Jackson annotations retain their established package. Check serializer modules and customizers during migration.

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

## 8. Added priorities for 2026

**Must know:** auto-configuration/back-off, dependency alignment, configuration binding/precedence, tests, Actuator access and readiness.

**Next:** `@SpringBootTest` versus focused slices, Testcontainers and `@ServiceConnection`, HTTP client configuration, graceful shutdown, Micrometer/OpenTelemetry, connection pools and bounded executors.

**Version-aware:** Boot 4's modularized artifacts and test support, HTTP Service Client auto-configuration, Framework 7 API versioning, Jackson 3 migration, AOT/native-image trade-offs. Boot 3.x / Framework 6.x remain important for existing-system interviews; latest documentation is not a recipe for every older application.

Virtual threads require a suitable Java runtime (not merely Boot's minimum Java version). They can help blocking-I/O concurrency but do not remove database connection limits, CPU limits or remote-service capacity.

**AI-age application questions:** how to externalize model configuration, choose compatible Spring AI/Boot versions, bound provider calls, export safe telemetry and run evaluations. Know `ChatClient`, structured output, tool calling, RAG and MCP at a conceptual level when the role requires them. AI-generated code still needs configuration, dependency, contract and security review; framework fluency remains necessary.

## 9. Interview drills

- A custom `DataSource` was added and a default disappeared. Explain conditional back-off.
- An auto-configuration ran "before" another, but its bean initialized later. Explain definition order versus dependencies.
- The application is listening, but its runner is still executing. Explain readiness-based routing.
- A lazy app starts quickly but fails on its first request. Explain the trade-off.
- `/actuator/conditions` is missing or forbidden. Separate endpoint exposure from access/security.
- An HTTP service repeatedly fails. Explain timeout, retry budget, circuit breaker and connection-pool interactions.

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
