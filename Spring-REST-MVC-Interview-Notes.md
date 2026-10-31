# Spring REST + MVC: Interview Notes

Reviewed: October 31, 2026. Source: the four-page Spring REST + MVC PDF, dated May 8, 2017, containing some later Framework 5 material.

This editorial Markdown conversion retains original subject coverage, replaces stale recipes, and explicitly adds interview gaps. It is not a line-by-line transcript. XML/JSP examples are summarized as legacy recognition material; choose Java configuration for modern examples.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> [Boot](Spring-Boot-Interview-Notes.md) -> **REST + MVC** -> [Data](Spring-Data-Interview-Notes.md) -> [Security](Spring-Security-Interview-Notes.md).

## Relevance and original-topic coverage

| PDF pages | Original coverage | Assessment |
|---|---|---|
| 1-2 | Negotiation, converters, body annotations, error handling | Still fundamental; extension-based negotiation and broad exception-handler claims need corrections. |
| 2-3 | RestTemplate, mappings, HTTP statuses | Keep legacy-client recognition; add RestClient, WebClient and HTTP interfaces. |
| 3 | DispatcherServlet, contexts, view resolvers | High value for architecture; XML startup defaults are not modern Boot setup. |
| 3-4 | Validation, exception views, localization | Keep; update Jakarta imports, method validation and interceptor configuration. |

## 1. Servlet MVC request flow

For a request mapped to Spring MVC, the useful mental model is:

```text
Servlet filters (including configured security)
  -> DispatcherServlet
  -> HandlerMapping identifies a handler
  -> HandlerAdapter invokes it, with argument resolution/binding/validation
  -> View rendering OR HTTP response-body conversion
  -> response unwinds through filters
```

Interceptors wrap supported handler execution within MVC. Exception resolvers participate when handler processing fails. `HandlerMapping` is not just "the configuration files"; it is infrastructure selecting a handler.

`DispatcherServlet` is the Servlet MVC front controller for its mappings, not necessarily every request reaching a server. Other servlets, static handling and filters may serve or reject a request.

Traditional deployments can have a root context loaded by `ContextLoaderListener` and a child context for each `DispatcherServlet`. Children can see parent beans, not vice versa. The XML context-location example in the PDF is actually a Servlet init parameter, not a listener definition. The traditional default is `/WEB-INF/{servlet-name}-servlet.xml`, not an arbitrary classpath file.

Boot typically registers and configures Servlet MVC infrastructure without `web.xml`. **Do not add `@EnableWebMvc` reflexively to a Boot app:** it opts into taking over MVC configuration. Use `WebMvcConfigurer` for ordinary customizations while retaining Boot defaults.

## 2. Controllers, mapping and binding

- `@Controller` is a stereotype for a controller; a returned string often denotes a view name.
- `@RestController` combines `@Controller` with `@ResponseBody`. Its results use response-body handling rather than ordinary view-name resolution.
- `@ResponseBody` can apply to a class or method. The PDF's "each method must be annotated" ignores class-level use and `ResponseEntity`.
- `@RequestMapping` supports class-level common mappings and method-level details. Composed annotations such as `@GetMapping` and `@PostMapping` improve clarity.
- `@PathVariable` binds a URI-template segment, `@RequestParam` query/form parameters, and `@RequestHeader` a header.
- `@RequestBody` uses a message converter to deserialize the body; `@ModelAttribute` uses model binding, commonly for forms; `@RequestPart` helps handle multipart content.
- `ResponseEntity<T>` carries status, headers and a body; it does not require `@ResponseBody`.

**Added:** use dedicated input/output DTOs instead of directly binding persistence entities. Protect against unwanted field binding, validate ranges and sizes, and make nullable/optional contracts explicit.

## 3. Representations and negotiation

`HttpMessageConverter` converts between HTTP bodies and Java representations for Servlet MVC. A JSON converter is not a view resolver.

The request's **Content-Type** describes the body sent to the server; **Accept** describes response formats acceptable to the client. Mapping `consumes` and `produces` refine the supported contract.

| Situation | Typical response |
|---|---|
| Request body format unsupported | `415 Unsupported Media Type` |
| No acceptable response representation | `406 Not Acceptable` |
| Malformed JSON or binding input | Usually `400 Bad Request` |

The original "look at .json/.xml before Accept" behavior reflects old path-extension negotiation. It is not the current default recipe; deprecated path-extension negotiation settings are removed in Framework 7. Prefer explicit supported media types and header-based negotiation.

`ContentNegotiatingViewResolver` can select among views for human-facing representations. It does not deserialize request bodies and is not the main JSON REST pipeline.

`InternalResourceViewResolver` historically maps names to resources such as JSPs using prefixes/suffixes. It remains recognition material for server-rendered applications, not a requirement for REST.

## 4. HTTP semantics

**Added:** annotations route requests; they do not automatically make an API RESTful.

| Method / operation | Contract to explain |
|---|---|
| GET, HEAD | Safe; do not intentionally mutate application state. HEAD returns no response body. |
| POST creation | Commonly `201 Created` with a `Location`; POST is not generally idempotent. |
| PUT | Idempotent semantics, typically replacement at the selected resource URI. |
| PATCH | Partial modification; idempotency depends on the operation. |
| DELETE | Idempotent effect, not necessarily identical status on every repeated request. |

Successful DELETE can return `204` without a body, `200` with a representation describing the result, or `202` when accepted for asynchronous processing. The original table's 200/204 options are useful but not exhaustive.

Know `400`, `401`, `403`, `404`, `409`, `415`, `422`, `429` and `5xx` without treating one as a universal answer for every validation or domain failure. Distinguish syntax/binding errors, business conflicts and authentication/authorization failures.

For retryable writes, design idempotency keys/deduplication and ownership checks. Also study caching, ETags/conditional requests, pagination limits and API evolution.

## 5. Validation

Modern Bean Validation uses `jakarta.validation.*` with an appropriate provider. `@Valid` triggers nested validation; it does not itself define constraints. Spring's `@Validated` can support groups and method-validation arrangements.

Framework 6.1+ MVC distinguishes:

- Individual command-object validation, commonly raising `MethodArgumentNotValidException`.
- Method-level parameter/return-value constraints, commonly raising `HandlerMethodValidationException`.

Handle both as required by the signatures. `BindingResult`/`Errors` placement immediately after the related parameter matters. A class-level `@Validated` uses AOP method validation; remove it when choosing MVC's built-in controller method validation.

Custom Spring `Validator` implementations and `@InitBinder` still have uses. Input validation does not replace authorization or database constraints.

## 6. Errors and exception boundaries

- `@ExceptionHandler` handles matching exceptions in a controller or advice.
- `@ControllerAdvice` applies shared controller concerns; `@RestControllerAdvice` adds response-body semantics.
- `ResponseEntityExceptionHandler` provides a base for MVC exception handling.
- `ResponseStatusException` is useful for programmatic HTTP status decisions. Keep domain logic from depending unnecessarily on HTTP-specific exceptions.
- `@ResponseStatus` can declare status behavior on a handler or exception. Reason-based/container error handling deserves care for JSON APIs.
- `HandlerExceptionResolver` is MVC infrastructure. It does **not** mean every exception anywhere in the application is handled by MVC advice.

Security failures in filters usually belong to `AuthenticationEntryPoint`/`AccessDeniedHandler`; asynchronous jobs have their own error boundaries. Do not expect `@RestControllerAdvice` to catch them all.

**Added:** use a consistent error contract, often Spring's `ProblemDetail`/`ErrorResponse` support for RFC 9457 problem details. Include stable error codes and safe correlation information, not stack traces, SQL or secrets. Mapping every `IllegalArgumentException` to `409`, as in the illustrative old code, is not a sound universal policy.

For server-rendered legacy applications, `SimpleMappingExceptionResolver` can map exceptions to error views. That is different from a REST problem response.

## 7. HTTP clients

| Client | What to study |
|---|---|
| `RestTemplate` | Legacy synchronous client; recognize `execute`, `exchange`, `getForEntity`, `postForEntity`. |
| `RestClient` | Modern synchronous fluent API, introduced in Framework 6.1. |
| `WebClient` | Reactive/streaming client; do not block an event-loop thread with blocking work. |
| HTTP Service Clients (`@HttpExchange`) | Declarative interfaces backed by configured HTTP-client infrastructure. |

Framework 7.0 deprecates RestTemplate in the reference documentation; the release notes distinguish this from planned Java `@Deprecated` marking in 7.1. It is not removed merely because a new client is preferred. `AsyncRestTemplate` is obsolete; do not use its old recipe for new asynchronous code.

`execute` supports low-level request/response callbacks; `exchange` works with entities and response types; convenience methods reduce boilerplate. There is no reason to memorize every overload.

**Added:** configure connection and response timeouts, pooling, credentials, status handling, bounded retries, generic response types and observability. A client library does not "enforce REST best practices" or automatically make retries safe.

## 8. Localization

`LocaleResolver` determines locale; `MessageSource` resolves localized messages.

`SessionLocaleResolver` stores locale in the session. `LocaleChangeInterceptor` can switch it from a configured request parameter. Register an interceptor through modern MVC configuration, not the removed `DefaultAnnotationHandlerMapping` from the PDF.

`AcceptHeaderLocaleResolver` can select locale using `Accept-Language`; a header-based resolver is not interchangeable with a mutable session locale. Localize safe error messages without changing stable machine-readable codes.

## 9. Added 2026 and AI-age priorities

**Must know:** full request pipeline, DTO/binding/validation, representations/statuses, error boundaries, HTTP-client choice and security integration.

**Next:** filters versus interceptors, multipart limits, async Servlet processing, `SseEmitter`/streaming, MockMvc versus live-server tests, contract tests, caching and rate limiting.

**Version-aware:** Framework 7 API versioning and RestTestClient, Jackson 3, modern path-pattern rules. Servlet MVC and WebFlux are distinct stacks; REST and `@RestController` are not exclusive to MVC, contrary to the PDF's "Spring REST always needs MVC" statement.

Virtual threads and reactive programming are different concurrency approaches. Neither permits unlimited work against a limited connection pool or model provider.

For AI endpoints, design streaming cancellation, timeouts, bounded payloads, safe error messages and explicit outcome status. Validate structured model output as untrusted input; do not convert arbitrary model text into executable actions. Authentication and resource authorization still apply to every retrieval/tool operation.

## 10. Interview drills

- A REST handler returns a String. Explain why it is a body under `@RestController`, but may be a view under `@Controller`.
- A client sends JSON with the wrong Content-Type. Explain converter selection and 415 versus 406.
- A filter rejects authentication. Explain why MVC advice may never execute.
- A POST times out after the database committed. Explain retry-safe API design.
- Validation starts throwing a different exception after controller constraints change. Explain object versus method validation.
- A streaming client disconnects. Explain cancellation, resource cleanup and downstream call budgets.

## Change references

**Version change** identifies changed APIs/defaults; **correction** identifies an inaccurate/incomplete original explanation; **addition** identifies missing coverage. Locations are PDF pages. References were checked during the October 31, 2026 review; current URLs may later track newer releases.

| Original location / claim | Category and correction | Official evidence |
|---|---|---|
| p. 1: path extension first for negotiation | Version change: do not use this as a current default; Framework 7 removed deprecated extension-negotiation options. | [Framework 7.0 removed path-mapping APIs](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes#deprecated-path-mapping-options-removed) |
| pp. 1, 3: every method needs ResponseBody | Correction: class-level RestController/ResponseBody and ResponseEntity also enable body responses. | [ResponseBody](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/responsebody.html) and [ResponseEntity](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/responseentity.html) |
| pp. 1-2, 4: resolver handles exceptions anywhere | Correction: MVC exception resolution has a request-processing boundary, not a universal application catch. | [MVC exceptions](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/exceptionhandlers.html) and [Security architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html) |
| p. 2: RestTemplate and AsyncRestTemplate as main choices | Version change: learn RestClient/WebClient/HTTP interfaces; distinguish documentation deprecation in 7.0 from Java annotation status. | [Official HTTP client discussion](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring) and [Framework 7.0 deprecations](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes#deprecations) |
| p. 3: EnableWebMvc for any Java-configured application | Qualification: Boot users ordinarily extend defaults with WebMvcConfigurer; EnableWebMvc takes over MVC configuration. | [Boot Servlet MVC configuration](https://docs.spring.io/spring-boot/reference/web/servlet.html) |
| p. 3: REST requires MVC; DispatcherServlet sees every request | Correction: REST is not exclusive to MVC; Servlet dispatch depends on mappings. | [MVC DispatcherServlet](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html) and [WebFlux](https://docs.spring.io/spring-framework/reference/web/webflux.html) |
| p. 3: default Servlet XML file in classpath | Correction: traditional WebApplicationContext defaults are deployment-relative; Boot initialization is a different arrangement. | [MVC context hierarchy](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/context-hierarchy.html) |
| pp. 3-4: JSR-303 overview only | Version change/addition: Jakarta Validation, plus MVC built-in method validation added in Framework 6.1 and its two exception paths. | [MVC validation](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html) |
| p. 4: DefaultAnnotationHandlerMapping locale recipe | Version-aware replacement: register interceptors through current MVC configuration. | [MVC interceptors](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-config/interceptors.html) and [locale resolution](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/localeresolver.html) |
| Consistent problem responses absent | Addition: ProblemDetail/ErrorResponse with RFC 9457 support; redact implementation details. | [MVC error responses](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html) |
| Modern API versioning / tests absent | Addition: Framework 7 API versioning and RestTestClient. | [Framework 7.0 release notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes) and [official HTTP client discussion](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring) |

Not every correction reflects a recent release change. In particular, HTTP semantics and exception boundaries must not be presented as new in 2026.

## Official references

- [MVC DispatcherServlet](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html)
- [Annotated MVC controllers](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller.html)
- [MVC validation](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html)
- [MVC error responses](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
- [Spring HTTP clients](https://docs.spring.io/spring-framework/reference/integration/rest-clients.html)
- [State of HTTP clients](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring)
- [Framework 7.0 release notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)

Current reference links can advance beyond a target application's version; use that version's documentation for exact imports/defaults.
