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

### Filters versus interceptors in a JSON REST application

**Recall:** a filter surrounds the servlet request pipeline; an interceptor surrounds a selected MVC handler. Neither requires server-rendered views. With Spring Security and Micrometer already configured, prefer their existing facilities over writing equivalent custom code.

| Aspect | Servlet filter | MVC interceptor |
| --- | --- | --- |
| Executes within | Servlet pipeline, outside MVC | MVC, after handler selection |
| Scope | Requests matching its URL/servlet and dispatcher-type registration | MVC handlers matching its configuration, including supported resource handlers |
| Knows the selected controller method? | Not inherently on entry | Can inspect a `HandlerMethod` |
| Wraps request/response? | Can pass wrappers down the chain | Not through the interceptor API |
| Stops processing | Does not call `chain.doFilter(...)` | Returns `false` from `preHandle(...)` and arranges a response |

### Real-world reasons to write a filter

| Requirement | Why a filter fits |
| --- | --- |
| A support-request ID must appear even on security rejection responses | Establish the ID/header before security; integrate with existing tracing rather than create a competing trace system |
| Custom request logging context | Set context before the chain, then restore/clear it in `finally` so pooled threads do not retain another request's values |
| Narrowly selected request/response diagnostics | Pass wrappers downstream, with strict size limits and redaction; avoid buffering streaming responses |
| A transport-level compatibility rule across registered requests | Reject an obsolete client protocol before MVC; prefer gateway enforcement if the gateway owns the policy |

An interceptor cannot add a header to a request already rejected by a security filter: it never gets invoked. A filter placed appropriately before security can do so. Filter ordering is therefore part of the design.

Reading a request body can consume it before MVC deserializes the JSON unless wrapping is handled correctly. Do not blindly log bodies containing credentials/personal data, large uploads or streams.

### Real-world reasons to write an interceptor

| Requirement | Why an interceptor fits |
| --- | --- |
| Endpoint-specific maintenance switch | Inspect a marker such as `@MaintenanceSensitive` and reject with 503 before invoking the handler |
| Deprecation/sunset headers only for marked endpoints | Inspect controller-method metadata and set headers in `preHandle` |
| Compatibility-header validation for selected legacy endpoints | Apply policy using handler metadata instead of repeating checks in controllers |

### Sample: sunset header on a marked REST endpoint

These are separate files in the application's scanned package; imports are omitted. Use Java's annotation types, Jakarta Servlet request/response types, and Spring MVC's `HandlerInterceptor`, `HandlerMethod` and configuration types.

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface DeprecatedApi { }
```

Mark a REST controller method with `@DeprecatedApi`. This interceptor examines that selected method:

```java
public class ApiSunsetInterceptor implements HandlerInterceptor {
    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) {
        if (handler instanceof HandlerMethod method
                && method.hasMethodAnnotation(DeprecatedApi.class)) {
            response.setHeader("Sunset", "Wed, 30 Jun 2027 23:59:59 GMT");
        }
        return true;
    }
}
```

Register it explicitly with MVC:

```java
@Configuration(proxyBeanMethods = false)
public class ApiWebConfig implements WebMvcConfigurer {
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new ApiSunsetInterceptor())
                .addPathPatterns("/api/**");
    }
}
```

The date is an illustrative API retirement policy, not a framework default. `@Component` on an interceptor alone does not attach it to MVC. This example needs no `@EnableWebMvc`; it retains Boot's MVC defaults.

**REST timing:** set headers in `preHandle`, not `postHandle`. For `@ResponseBody`/`ResponseEntity`, JSON may already be written and the response committed before `postHandle`. Use `ResponseBodyAdvice` for supported response-body customization.

### Keep each concern at its owning boundary

Business rules belong in services so other entry points cannot bypass them. Authentication, tenant membership and resource authorization belong in Spring Security/method security, not merely an interceptor checking a header. Use Bean Validation for JSON constraints and exception advice for controller/service failures.

A controller failure resolved by advice may not escape to an outer filter, and an interceptor's `afterCompletion` may receive no exception for that resolved failure. No escaping exception does not mean success: consider the HTTP status and application outcome.

For asynchronous requests, a filter's `finally` cleans up the current thread, not necessarily the completed request. Interceptor completion can occur on a later dispatch; dispatcher types and async/error handling must be configured deliberately. If `preHandle` returns false, that interceptor's own `afterCompletion` is not called.

**Decision:** use a filter for work before/outside MVC or request/response wrapping; use an interceptor when the concern needs selected-handler metadata. Otherwise, an existing framework facility or ordinary service code is often simpler.

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

### REST recall: advice translates a propagated exception into a response

**For a JSON REST API, `@RestControllerAdvice` is the shared glue between application failures and the HTTP error contract.** In a standard Boot MVC web app, no extra resolver configuration is needed: put the advice beneath the component-scan root (or explicitly import it), and ensure it applies to the controller.

```text
Controller calls service
    -> controller or service throws OrderConflictException
    -> exception propagates out of the controller
    -> MVC finds the matching @ExceptionHandler
    -> handler returns status + safe problem body
    -> Spring writes the HTTP response
```

The controller does not need a `try/catch`, an explicit call to the advice, or manual handler registration.

### Sample: map an order conflict to HTTP 409

These are separate Java files under your application's scanned package; imports are omitted. The sample uses Spring Framework 6+ `ProblemDetail` and represents a domain conflict, not a universal mapping for all failures.

```java
public class OrderConflictException extends RuntimeException {
    public OrderConflictException(String message) {
        super(message);
    }
}
```

```java
@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(OrderConflictException.class)
    public ResponseEntity<ProblemDetail> handleConflict(OrderConflictException ex) {
        ProblemDetail body = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT,
                "The order cannot be changed in its current state.");
        body.setTitle("Order conflict");
        body.setProperty("code", "ORDER_STATE_CONFLICT");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }
}
```

If a REST controller throws `OrderConflictException`, or lets that exception propagate from its service, the client receives HTTP **409** with a problem body resembling:

```json
{
  "type": "about:blank",
  "title": "Order conflict",
  "status": 409,
  "detail": "The order cannot be changed in its current state.",
  "code": "ORDER_STATE_CONFLICT"
}
```

Spring may also populate `instance` with the request path. The HTTP status gives the broad classification; the stable `code` identifies the application failure for Angular/React. Do not make the frontend parse Java exception names or message text. This sample deliberately does not return `ex.getMessage()`, which may contain internal details.

### What to map, and what happens otherwise

Add handlers for other application failure categories with appropriate statuses and safe bodies. You do not need one method per exception class: related exceptions can share a handler, and handlers can match subclasses. Spring already handles many standard MVC failures; extend `ResponseEntityExceptionHandler` and override its relevant hooks when normalizing binding/validation responses.

| Situation | Result |
| --- | --- |
| Matching controller-local handler exists | It is considered before shared advice |
| Exception reaches MVC and applicable advice has a matching handler | Advice translates it into the response |
| Lower layer catches it and returns normally | Advice never sees that failure |
| No custom handler matches | Other resolvers/error handling apply; unexpected failures usually result in 500 |
| Response already committed, such as during streaming | A new status and problem body generally cannot replace the response |

With multiple advice classes, ordering and specificity matter; avoid an indiscriminate catch-all that turns every failure into 500. Verify status and error-body contracts in MVC tests.

**Handling the HTTP response does not perform rollback or recovery.** Those belong to the transaction/business boundary. Authentication failures in filters and detached background-job failures have separate handling paths, not this MVC advice path.

### Supporting APIs and boundaries

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

## 10. Interview questions: answers and scenarios

Use these to explain decisions, failure paths and trade-offs, not to recite annotations. Assume a Spring MVC JSON backend with an Angular/React frontend unless stated otherwise. WebSocket questions distinguish raw WebSocket transport from optional STOMP messaging.

### 10.1 Have you used Spring MVC if the frontend renders everything?

**Answer:** yes, if the backend uses the Servlet MVC stack for REST. MVC still routes requests, binds input, validates arguments and converts response bodies; it need not render HTML. Under `@RestController`, a returned String is response-body content, not a template name. A plain String also does not automatically become a structured JSON object; conversion and media type matter.

**Scenario:** a controller returns `"orders"`. React receives body content rather than an orders page. Return an explicit DTO when the contract requires JSON fields, rather than relying on the frontend to interpret arbitrary text.

### 10.2 JSON is valid, but the request fails. What do you inspect?

**Answer:** separate representation selection from syntax and validation. `Content-Type` describes the incoming body; `Accept` describes acceptable responses. An unsupported request format typically gives 415, an unavailable response representation 406, malformed JSON/binding usually 400. Valid JSON can still violate the application's input contract.

**Scenario:** the client sends JSON labelled `text/plain` to a JSON-only operation: 415. It requests XML from an operation that only produces JSON: 406. Fix the contract/headers rather than catching every failure as a business conflict.

### 10.3 Why not accept and return database entities directly?

**Answer:** HTTP contracts and persistence models evolve independently. DTOs restrict writable fields, avoid accidental relationship/internal-field exposure, and make validation and serialization predictable. Neither DTO validation nor entity annotations replace authorization.

**Scenario:** an update payload includes `ownerId` and `approved=true`. An explicit update DTO excludes fields the caller cannot change; the service verifies ownership from trusted identity and current state. Do not rely on the frontend hiding those fields.

### 10.4 Is REST error handling just choosing an HTTP status?

**Answer:** status gives the broad HTTP meaning; a stable error code and safe problem body identify the application failure. Shared advice translates uncaught MVC request failures without repetitive controller catches. It must be discovered and applicable; it does not perform rollback or cover every filter/background failure.

**Scenario:** both a dispatched order and a version conflict might produce 409, but React needs different actions. Return distinct stable codes, not Java exception names or raw exception messages. Unexpected failures receive safe 500 responses with protected, correlated diagnostics.

### 10.5 Why can an authentication failure bypass REST advice?

**Answer:** security filters can reject before MVC selects or invokes a controller. The security entry point/access-denied handler owns that response. Align its error contract with REST errors, but do not assume controller advice catches it.

**Scenario:** an expired credential produces 401 before the controller runs. A filter positioned before security can add a support ID; a controller interceptor cannot. Distinguish this from an authenticated caller lacking permission, normally 403.

### 10.6 When would you write a filter or interceptor in a JSON app?

**Answer:** use a filter for servlet-wide concerns or wrappers; use an interceptor for selected-handler metadata. Prefer existing security, tracing and validation facilities. REST JSON can already be written before `postHandle`, so it is not a reliable response-customization point.

**Scenario:** a support header must exist on security rejections: filter before security. A sunset header applies only to marked controller methods: interceptor `preHandle`. Changing serialized JSON: response-body advice. Core business rules remain in services.

### 10.7 Why did validation stop producing the exception your handler expects?

**Answer:** validation has distinct paths. Request-object constraints and controller method parameter/return-value constraints can raise different MVC exceptions. Support the signatures you expose, normalize errors, and distinguish bad client input from a server violating its own return-value contract.

**Scenario:** moving a constraint onto a controller parameter introduces MVC method validation in Framework 6.1+. A handler covering only request-object validation is insufficient. Test both paths; do not map an invalid server return value to a client 400.

### 10.8 A POST timed out. Can the client safely retry?

**Answer:** timeout means the outcome is unknown, not necessarily that the operation failed. A commit or remote side effect may have succeeded before the response was lost. Retrying writes needs an explicit idempotency and reconciliation contract.

**Scenario:** order creation commits but the connection breaks. Scope an idempotency key to the caller/operation, associate it with the request identity and durably coordinate it with the result. Concurrent duplicates must not create two orders; reuse with different input must be rejected. A lookup/status path lets the client discover the outcome.

### 10.9 Does an exception response guarantee rollback?

**Answer:** no. Transaction rules govern local state; advice governs HTTP output. An unchecked exception escaping a standard transactional boundary normally causes rollback, while checked-exception policy is configurable. Caught failures and rollback-only state complicate the outcome. Remote effects are not undone by local rollback.

**Scenario:** payment succeeds but saving the order fails. Returning 500 does not refund the payment. Use an explicit workflow with idempotency, durable intent/outbox where appropriate, and compensation/reconciliation. Test state effects separately from response status.

### 10.10 Two users update the same resource. How do you prevent lost updates?

**Answer:** enforce concurrency control at the authoritative state boundary. Optimistic locking/version checks detect stale writes; HTTP ETags with `If-Match` can expose a conditional-update contract. A failed HTTP precondition normally yields 412; a domain conflict may use 409.

**Scenario:** two editors load version 7. The first saves version 8; the second must not silently overwrite it. Atomically check the version during the update and let the UI reload or reconcile. Checking a version and updating later without concurrency protection leaves a race.

### 10.11 How do browser security and CORS affect a JSON API?

**Answer:** CORS controls browser cross-origin access; it is not authentication or authorization and does not restrict non-browser clients. CSRF risk depends on how credentials are attached, especially automatically sent cookies, not whether the payload is JSON.

**Scenario:** React runs on a different origin and preflight fails before the API call. Configure supported origins, methods and credentials with the security pipeline. Do not fix it with unrestricted credentialed origins or assume CORS prevents unauthorized server-to-server requests.

**Memory hook: CORS = sharing data across origins; CSRF = forging an action using your login.**

| Term | Full name | Question to remember |
| --- | --- | --- |
| CORS | Cross-Origin Resource Sharing | May JavaScript from this other origin read this API response? |
| CSRF | Cross-Site Request Forgery | Did the user intend this action, or did another site trick their browser into sending it with their credentials? |

**CORS example: your legitimate frontend.** React at `https://app.example.com` calls `https://api.example.com`. These are different origins: an origin is scheme + host + port. Browser same-origin policy normally prevents cross-origin JavaScript from reading the response unless the API permits that origin through CORS response headers.

For requests requiring preflight, such as a typical `application/json` POST or a request with an `Authorization` header, the browser first sends `OPTIONS` asking whether the origin, method and headers are allowed. A failed preflight prevents that actual request. Other requests can be sent without preflight even though the browser later blocks JavaScript from reading the response. **A CORS error does not always mean the server received no request or performed no action.**

For cookie-based cross-origin calls, the frontend must opt into credentials and the server must permit credentials with an explicit allowed origin, not `*`. Cookie SameSite rules and browser cookie restrictions still apply. Postman/curl do not enforce browser CORS, which explains "works in Postman, fails in React."

**CSRF example: an attacker's frontend.** You are logged into a banking site using a session cookie. You visit an attacker's site, which attempts to submit a transfer request to the bank. If the browser attaches the bank's cookie under the applicable cookie rules and the bank accepts the request without checking intent, the attacker has caused an authenticated action. The attacker does not need to read the response.

Typical defenses are a CSRF token that the legitimate frontend obtains and returns in a header/form field, suitable SameSite cookies, and server-side Origin/Referer validation as part of the defense. A cross-site attacker normally cannot read the token. Never make GET perform sensitive state changes.

**JSON/JWT does not settle the question.** A bearer token explicitly attached by your frontend in `Authorization` is not normally attached automatically by the browser to an attacker's request, reducing traditional CSRF exposure. The same JWT stored and accepted in an automatically sent cookie can still create CSRF risk. XSS/token theft is a separate threat; moving tokens to JavaScript-accessible storage is not a blanket security recommendation. Strict JSON/content-type enforcement helps block simple form attacks but is not a reason to disable CSRF protection without reviewing the credential model.

**Spring recall:** configure CORS with the security pipeline so preflight is handled before authentication rejects it. For cookie/session-authenticated state-changing requests, retain/configure CSRF protection and have the frontend return the token. Do not disable CSRF merely because the application is REST or called stateless.

**One-line contrast:** CORS grants a frontend permission to read; CSRF defenses prevent an attacker from abusing automatically attached credentials to act. You can need both.

### 10.12 How do you keep an API responsive when a dependency is slow?

**Answer:** budget total request time across connection acquisition, connection/read timeouts, retries and processing. Bound concurrency and queues. Retry only appropriate transient failures, within the budget and with safe write semantics. More threads, virtual threads or reactive code do not increase database/provider capacity.

**Scenario:** an upstream call takes 30 seconds while the ingress timeout is 20 seconds. The caller can disconnect while backend work continues. Align budgets, support cancellation where possible, and measure pool waits and dependency latency instead of merely extending every timeout.

### 10.13 When should an API return 202 instead of holding the request open?

**Answer:** when work is accepted for asynchronous execution and the contract exposes how to discover its eventual outcome. Acceptance is not completion. Persist or durably enqueue accepted work and provide a job ID/status location, authorization and terminal failure states.

**Scenario:** generating a large report takes minutes. Return 202 after durable acceptance, then let the frontend poll or receive notifications. Starting an untracked in-memory task and claiming acceptance can lose the work during a pod restart.

### 10.14 What changes when streaming starts and the client disconnects?

**Answer:** once the response is committed, a normal problem response cannot replace it. Define stream completion/error signals, cancellation and cleanup. Propagate cancellation to downstream work where supported; cancellation does not prove already-performed side effects were undone.

**Scenario:** a token stream fails halfway through. The UI must distinguish incomplete output from successful completion. Release resources, enforce downstream budgets, and use an explicit terminal signal rather than treating connection closure as proof of success.

### 10.15 Which tests prove a REST contract rather than merely the logic?

**Answer:** service unit tests check logic; MVC tests exercise routing, conversion, validation and advice when those components are included. Live-server tests cover actual HTTP behavior. Proxy/ingress behavior, network failures and real WebSocket connections require suitable integration or end-to-end coverage.

**Scenario:** a service test passes, but invalid JSON returns the wrong status. An MVC contract test catches it. A correct MVC response does not prove ingress timeouts, CORS deployment settings or retry-safe persistence; test each boundary deliberately.

### 10.16 When would you choose polling, SSE or WebSocket?

**Answer:** use polling when occasional refresh is enough. SSE provides server-to-client events over a long-lived HTTP response; WebSocket provides bidirectional messages over an upgraded connection. Choose by interaction needs and operational cost, not because real-time sounds modern. Browser APIs also have differing authentication constraints.

**Scenario:** report status updates may need polling or SSE, while collaborative editing needs bidirectional communication. WebSocket adds connection lifecycle, routing and message-contract responsibilities; it does not replace REST for every operation.

### 10.17 After a WebSocket upgrade, do messages use REST controllers and HTTP status codes?

**Answer:** no. Raw WebSocket carries frames/messages, not a new HTTP request for each message. The application defines payloads, correlation IDs, validation and errors. STOMP is an optional messaging protocol over the transport with destinations/subscriptions; it is not inherent to WebSocket.

**Scenario:** the initial handshake succeeds, but a later message requests an invalid operation. Return an application message or appropriate protocol error/close behavior, not a fictional HTTP 409 on that message. MVC REST advice is not the message error boundary; STOMP handlers can use messaging exception handling such as `@MessageExceptionHandler`.

### 10.18 Is securing the WebSocket handshake enough?

**Answer:** no. Establish identity at the handshake or through a supported messaging authentication flow, then authorize message actions and subscriptions. Validate origins for browser connections and define credential expiry/revocation behavior. Browser WebSocket APIs cannot set arbitrary handshake headers like an ordinary HTTP client.

**Scenario:** a user connects successfully, then subscribes to another customer's order updates. Authenticate the connection, but also check destination/resource access using trusted identity. Origin checks are not user authorization, and trusting a user ID in a message permits impersonation.

### 10.19 What happens to WebSocket connections when AKS scales to multiple pods?

**Answer:** each established connection is held by one pod; per-pod session/subscription state is not automatically shared. Cross-pod delivery needs shared messaging or another deliberate routing design. Spring's simple STOMP broker keeps subscriptions in local memory; it is not a cluster-wide broker.

**Scenario:** a client is connected to pod A, but pod B processes its order. Publishing only to B's local subscribers misses that client. Use a suitable broker relay/shared event mechanism and route to the owning connections. Sticky sessions alone do not solve cross-pod event delivery or durable replay.

#### Worked example: order tracking across two pods

**Goal:** a browser connected to pod A must receive an order update committed on pod B. Keep REST for order creation/status queries and use WebSocket for live notifications.

The browser subscribes to `/topic/orders.123`. This is a STOMP destination, not a REST URL or a separate WebSocket connection. One connection can carry multiple subscriptions.

**First demonstrate the failure with Spring's local simple broker:**

```text
Browser -- WebSocket + subscription --> Pod A [local simple broker]
Order update -- REST ----------------> Pod B [local simple broker]
                                           |
                                           -> no local subscriber for order 123
Browser receives nothing.
```

The ingress chooses a backend for each new connection/request. A successful WebSocket upgrade stays on its chosen pod; individual frames are not load-balanced afresh. Another HTTP request or background consumer can execute on a different pod. Affinity might hide the problem for one browser's requests, but does not route updates from other users, workers or services.

#### Solution: a shared STOMP broker with Spring acting as the relay

For example, use RabbitMQ with its STOMP plugin enabled. Both pods connect to the same broker deployment:

```text
Browser -- WebSocket --> Pod A relay -- TCP/STOMP --> Shared broker
                           ^                            ^
                           |                            |
                           +--- matching message -------+
                                                        |
Order REST update --> Pod B --> publish via relay -------+
```

Pod A forwards the browser's subscription to the broker over that client's broker connection. Pod B publishes to the same destination. The broker routes the message to matching subscriptions; pod A forwards it over its existing browser socket.

**No pod-to-pod socket lookup is needed for this topic design.** The broker knows the subscriptions; pod A owns the browser connection. Use topic/fan-out semantics when every subscribed browser should receive the update, not competing consumers on one work queue, where only one consumer receives a message.

#### Sample Spring configuration

This is a teaching skeleton for a Boot Servlet application, not a production-ready deployment or a claim that this repository runs a broker. Imports are omitted. Use `spring-boot-starter-websocket` plus the relay's TCP dependencies required by your Spring version; the current reference lists Reactor Netty and Netty dependencies. Use Boot-managed compatible versions. The broker needs STOMP enabled and an explicitly provisioned service account; its AMQP port is not its STOMP port.

```java
@Configuration(proxyBeanMethods = false)
@EnableWebSocketMessageBroker
public class OrderSocketConfig implements WebSocketMessageBrokerConfigurer {
    @Value("${orders.broker.host}")
    private String brokerHost;

    @Value("${orders.broker.port}")
    private int brokerPort;

    @Value("${orders.broker.login}")
    private String brokerLogin;

    @Value("${orders.broker.passcode}")
    private String brokerPasscode;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOrigins("https://app.example.com");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.setApplicationDestinationPrefixes("/app");
        registry.enableStompBrokerRelay("/topic")
                .setRelayHost(brokerHost)
                .setRelayPort(brokerPort)
                .setSystemLogin(brokerLogin)
                .setSystemPasscode(brokerPasscode)
                .setClientLogin(brokerLogin)
                .setClientPasscode(brokerPasscode);
    }
}
```

Both pods receive the same broker settings. Supply credentials from your secret-management mechanism, never from committed source. `61613` is a common plain STOMP port for an isolated local exercise, not a production TLS configuration. Broker TLS, virtual host, permissions and availability require explicit deployment-specific setup.

`/ws` is the HTTP handshake endpoint. `/topic/...` destinations are broker-routed. `/app/...` is a prefix for application message handling if you add it; it does not create handlers automatically. Do not retain `enableSimpleBroker` as a parallel alternative for these same destinations.

**Security is additional to this skeleton:** authenticate `/ws`; authorize each order subscription against trusted user identity; deny browser SEND messages to server-owned `/topic/...` destinations to prevent spoofed updates. Allow only intended message types/destinations and set payload limits. With Spring Security WebSocket integration, supply the required CONNECT CSRF token as configured. Origin restrictions are not resource authorization.

The relay's broker credentials authenticate its broker connections, not your end users. They stay server-side; do not send them to the browser. Shared service-account broker permissions cannot replace application-level order-access checks.

#### Sample publication after a committed order change

Assume the transactional order service publishes this application event inside its database transaction, using the updated order's authoritative version:

```java
public record OrderStatusChanged(
        String eventId, String orderId, long version, String status) { }
```

```java
@Component
public class OrderNotifications {
    private final SimpMessagingTemplate messaging;

    public OrderNotifications(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderChanged(OrderStatusChanged event) {
        messaging.convertAndSend(
                "/topic/orders." + event.orderId(), event);
    }
}
```

`SimpMessagingTemplate` sends through the configured relay, so a listener running on B can reach a subscriber on A. The event is serialized as JSON using the configured message converter. The event listener requires a surrounding transaction; without one it does not run by default.

**Why after commit?** Publishing before commit could tell a browser about a change later rolled back. **What it does not solve:** a crash after commit but before publication, or a broker failure during publication. The committed order cannot be undone by this notification failure. For reliable publication, replace this best-effort handoff with an outbox written in the order transaction and a retrying publisher. Observe and report failures; do not assume successful database commit means successful notification.

A broker/outbox can still redeliver. Keep event IDs and order versions so clients can ignore duplicate or stale updates. Do not claim exactly-once browser processing.

#### What the browser exchanges

A STOMP client connects to `wss://api.example.com/ws`, completes CONNECT, then subscribes. Simplified frames, with protocol terminators omitted:

```text
Browser -> server/broker:
SUBSCRIBE
id:order-123
destination:/topic/orders.123

Broker -> pod A -> browser:
MESSAGE
subscription:order-123
destination:/topic/orders.123
content-type:application/json

{"eventId":"evt-456","orderId":"123","version":8,"status":"DISPATCHED"}
```

This message is not an HTTP response and does not go through a REST controller. The frontend updates its order display, but keeps REST as the authoritative snapshot/recovery path. This topic example notifies every authorized subscription to that order; per-user destinations add separate routing considerations.

#### Prove the design instead of just drawing it

| Experiment | Evidence to collect |
| --- | --- |
| Connect browser to A; execute the update specifically on B | Browser receives the matching order ID/version through A |
| Repeat using local simple brokers instead of the relay | Cross-pod notification is absent, establishing the original failure |
| Subscribe two authorized browsers, one on each pod | Both receive the topic event; delivery is not competing-consumer work distribution |
| Subscribe as an unrelated user; attempt browser publication to the topic | Subscription/publication denied by message security |
| Stop the broker during an order change | Database result and notification failure are distinguished; outbox retains work if implemented |
| Restart A | Its socket closes; client reconnects, re-subscribes and reconciles missed state |
| Retry/replay an older notification | Client does not regress the displayed order version |

Use explicit per-pod test connections/port-forwards to force A versus B in a controlled environment rather than hoping load balancing chooses them. Wait for subscription establishment, using broker receipts where supported, before triggering the update. Record pod identity and event ID in diagnostics without adding pod names to the public business contract. These are proposed experiments, not tests already executed here.

On reconnect, do not assume that resubscribing replays everything. A robust snapshot approach establishes the subscription, buffers live events, fetches the latest authorized REST snapshot, then applies newer versions. Handle gaps/reordering with refresh or a replay cursor; fetching once and subscribing afterward can miss an update between those operations.

#### Trade-offs and the interview takeaway

The relay adds a broker dependency and connection cost: Spring maintains a system connection per relay instance plus a broker TCP connection per connected WebSocket client. Size broker connection limits, pod buffers and outbound throughput; make the broker resilient. Readiness changes do not migrate established sockets during rollouts.

An alternative is shared event fan-out (for example Redis Pub/Sub) to each pod, with local session delivery. That requires an explicit fan-out/routing design and subscription/security management; Redis Pub/Sub alone is not durable replay. A managed WebSocket service can instead own connections and scale-out, with its own protocols, quotas and delivery contract.

**Interview answer:** "The problem is that connection ownership is local but events can originate anywhere. I would first demonstrate A/B delivery failure, then use a shared routing layer. I would separately design commit-to-publication reliability and client resynchronization, because a broker relay solves live routing, not end-to-end guaranteed delivery."

### 10.20 Does reconnecting a WebSocket restore missed messages and exactly-once processing?

**Answer:** no. Transport ordering on a live connection does not guarantee durable delivery, replay or business processing. Define event IDs, sequence/version information, acknowledgements where needed, retention and deduplication. STOMP acknowledgement capabilities depend on the broker; an acknowledgement is not automatically a business commit.

**Scenario:** a pod restarts after accepting a command but before acknowledging it. The client reconnects with backoff/jitter and may resend. Use command idempotency and a resume cursor or fresh authoritative snapshot so duplicates and gaps can be reconciled. Re-establish subscriptions explicitly.

### 10.21 How do you handle slow WebSocket consumers and rolling deployments?

**Answer:** bound message sizes, outbound buffers and send times. Decide whether updates can be coalesced/dropped or must be durably delivered. Heartbeats detect dead connections, not business health. During rollout, stop accepting new traffic, drain within a budget and expect clients to reconnect.

**Scenario:** one browser stops reading while updates continue. An unbounded queue exhausts memory. Disconnect/resync or coalesce disposable updates according to the contract; retain critical events durably. Kubernetes readiness changes do not migrate existing sockets, and ingress idle timeouts, termination grace periods and heartbeat intervals must work together.

**Final recall:** HTTP status plus body describes a request outcome; WebSocket messages need their own outcome contract. Neither a timeout nor a disconnect proves that no work happened. Security, state consistency and delivery semantics must hold across retries, concurrent callers and pod restarts.

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
- [Spring WebSocket and STOMP](https://docs.spring.io/spring-framework/reference/web/websocket.html)
- [Simple STOMP broker](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/handle-simple-broker.html)
- [STOMP broker relay](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/handle-broker-relay.html)
- [Spring HTTP clients](https://docs.spring.io/spring-framework/reference/integration/rest-clients.html)
- [State of HTTP clients](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring)
- [Framework 7.0 release notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)

Current reference links can advance beyond a target application's version; use that version's documentation for exact imports/defaults.
