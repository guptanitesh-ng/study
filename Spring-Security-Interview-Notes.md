# Spring Security: Interview Notes

Preparation focus: **security concepts and real-world decisions first; Spring implementation second**. Use [Authentication and Authorization: Application Patterns](Authentication-Authorization-Patterns.md) as the primary guide, especially its [scenario-led study plan](Authentication-Authorization-Patterns.md#9-focused-study-plan-security-decisions-and-defenses).

This is a compact framework companion, not a filter inventory or a configuration-memorization exercise. It retains the useful concepts from the August 2019 PDF while replacing its obsolete adapter-based recipes. Examples target **Boot 3.5 / Spring Security 6.5 Servlet applications**, omit imports/domain setup and are not an executed application. Match APIs and defaults to the actual project version.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> [Boot](Spring-Boot-Interview-Notes.md) -> [REST + MVC](Spring-REST-MVC-Interview-Notes.md) -> [Data](Spring-Data-Interview-Notes.md) -> [Security concepts and scenarios](Authentication-Authorization-Patterns.md) -> this Spring companion.

## 1. Servlet security architecture

```text
Request -> Servlet filter bridge -> first matching SecurityFilterChain
    -> credential validation / context restoration
    -> request authorization -> controller -> service/resource authorization
```

`DelegatingFilterProxy` connects the Servlet container to Spring; `FilterChainProxy` selects a chain. Know the responsibilities, not every internal filter or its historical order. WebFlux has a separate reactive chain.

**Keep:** only the first matching chain runs. `securityMatcher` selects a chain; `requestMatchers` select authorization rules inside it. A request matching no chain is not protected by those chains.

## 2. Modern configuration

Declare `SecurityFilterChain` beans using the lambda DSL, not `WebSecurityConfigurerAdapter` (removed in Security 6). Modern Servlet APIs use `jakarta.servlet`, not the old `javax.servlet` namespace.

```java
@Bean
SecurityFilterChain web(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(auth -> auth
            .requestMatchers("/public/**").permitAll()
            .anyRequest().authenticated());
    http.formLogin(Customizer.withDefaults());
    return http.build();
}
```

This is a form-login shape, not a JSON login endpoint. Supply real identity provisioning and password configuration. CSRF remains enabled; do not treat Boot's generated development identity as production account management.

## 3. Authentication contracts

| Responsibility | Spring mechanism |
| --- | --- |
| Extract credentials | Mechanism-specific authentication filter |
| Coordinate verification | `AuthenticationManager`, commonly `ProviderManager` |
| Verify a supported credential | `AuthenticationProvider` |
| Load password-account details | `UserDetailsService` |
| Verify stored password hash | Password provider with `PasswordEncoder` |
| Represent verified identity and permissions | `Authentication` and its `GrantedAuthority` values |

Loading a user is not authenticating a password. Prefer supported providers over custom credential checks. A provider may return `null` to defer to another provider; the manager's contract is authenticated success or failure.

## 4. SecurityContext and sessions

`SecurityContext` holds the current `Authentication`; Servlet code commonly accesses it through `SecurityContextHolder`. The configured `SecurityContextRepository` handles persistence/restoration where required.

Setting a thread's context is not a complete persistent login. Custom login must also apply the configured session-authentication protections and context-save mechanism. Prefer the standard flow.

`SessionCreationPolicy.STATELESS` tells Spring Security not to use an HTTP session for the security context. It does **not** prevent every component from creating a session/cookie, eliminate CSRF automatically or remove business/authorization state.

Do not assume arbitrary async threads inherit identity. Propagate context deliberately and clean it up; do not preserve stale authorization indefinitely.

## 5. Remember-me and logout

Remember-me is persistent re-authentication, not an indefinitely valid session. Its cookies remain credentials requiring protection and lifecycle policy.

Spring logout can clear context, invalidate the application session and remove configured cookies. With CSRF protection, the state-changing logout action is normally POST. Application logout, provider logout and access/refresh-token revocation are separate decisions: see [the logout and token-replay scenario](Authentication-Authorization-Patterns.md#93-i-copied-the-token-into-postman-what-happens-after-logout).

## 6. CORS: browser permission, not authorization

Configure trusted origins, methods and headers through consistent MVC/Security CORS integration, activated with `http.cors(...)` where appropriate. Preflight handling must not require credentials the browser does not send on preflight.

CORS controls browser response access, not caller identity or resource authorization. A simple cross-origin request may execute even if its response is unreadable. Do not solve CORS errors with `permitAll`, arbitrary origin reflection or by disabling CSRF.

## 7. CSRF and XSS

Spring Security enables CSRF protection by default for unsafe methods. Browser session/remember-me cookies and other automatically attached credentials require CSRF analysis. JSON and JWT do not decide the policy.

For session-based SPAs, follow the version-appropriate token repository/request-handler recipe, including login/logout renewal. An automatically returned cookie alone is not the submitted anti-CSRF proof. A readable CSRF cookie does not justify a readable authentication cookie.

A bearer-only API with explicitly attached credentials and no ambient fallback can have a different CSRF policy. XSS still matters: HttpOnly blocks direct cookie reading, not every action malicious same-origin script can perform.

Use the [scenario plan](Authentication-Authorization-Patterns.md#9-focused-study-plan-security-decisions-and-defenses) for the threat models; use Spring documentation for the exact integration.

## 8. Spring integration map

Choose the pattern in the companion guide; retain only the matching Spring entry point.

### 8.1 Choose an application pattern before choosing classes

Use established integrations. Do not implement OAuth by writing a controller that signs JWTs, or replace Resource Server support with a signature-only Servlet filter.

### 8.2 Pattern A: application-owned login and server session

[Pattern A](Authentication-Authorization-Patterns.md#2-pattern-a-application-owned-login-and-server-session) maps to `formLogin`, a password provider, `UserDetailsService`, `PasswordEncoder` and session context persistence. Section 2 shows the configuration shape. Keep CSRF and session protections.

### 8.3 Pattern B: enterprise OIDC login with a backend session

[Pattern B](Authentication-Authorization-Patterns.md#3-pattern-b-external-oidc-login-with-a-backend-session) maps to `spring-boot-starter-oauth2-client` and `http.oauth2Login(Customizer.withDefaults())`.

Configure client registration, trusted issuer, `openid` scope, exact callback URI and provider-compatible client/PKCE settings. The login integration validates the OIDC response and establishes a session. A complete BFF also needs server-side token storage, downstream scopes/audience, an outbound client and browser/session protections.

### 8.4 Pattern C: SPA obtains a token and calls the resource server

[Pattern C](Authentication-Authorization-Patterns.md#4-pattern-c-spa-obtains-a-token-and-calls-the-resource-server) maps to `spring-boot-starter-oauth2-resource-server` and `http.oauth2ResourceServer(resource -> resource.jwt(Customizer.withDefaults()))`.

Configure the trusted issuer, API audience, key/algorithm policy and authority conversion. Validate claims in addition to the signature. The API does not need `oauth2Login` for this role. A bearer-only chain may use `STATELESS`; justify CSRF policy from credential transport and configure CORS separately.

### 8.5 Pattern D: service-to-service client credentials

[Pattern D](Authentication-Authorization-Patterns.md#5-pattern-d-service-to-service-client-credentials) maps to OAuth2 Client support on the caller and Resource Server support on the receiver.

Register the `client_credentials` grant and supported client authentication. Use `OAuth2AuthorizedClientManager` to acquire/manage tokens, then wire it into the outbound client. For workers outside a Servlet request, `AuthorizedClientServiceOAuth2AuthorizedClientManager` is a suitable implementation. Declaring a manager alone sends no request.

### 8.6 Responsibility-to-class map

| Boundary | Mechanism worth recognizing |
| --- | --- |
| Request policy | `SecurityFilterChain`, `HttpSecurity` |
| Bearer extraction/validation | `BearerTokenAuthenticationFilter`; JWT provider/decoder or opaque-token provider/introspector |
| Current identity | `Authentication`, `SecurityContext` |
| Request/service authorization | `AuthorizationManager`; method security enabled with `@EnableMethodSecurity` |
| Unauthenticated/access-denied responses | `AuthenticationEntryPoint`, `AccessDeniedHandler` |

## OAuth, OIDC, JWT and opaque tokens: Spring integration

The [companion guide](Authentication-Authorization-Patterns.md#6-oauth-oidc-jwt-and-opaque-tokens-different-layers) owns the protocol distinctions and trade-offs.

JWT Resource Server support uses a `JwtDecoder` and validators. Opaque-token support uses an `OpaqueTokenIntrospector` configured with the provider's introspection endpoint and API credentials. In either case, enforce intended-resource and permission policy; successful validation is not universal authorization. Verify provider support rather than assuming introspection exists.

## 9. Broader security belongs in the scenario plan

Injection, SSRF, browser attacks, credential theft, multi-tenant isolation, abuse prevention, dependency/configuration risks and AI/tool authorization are not solved merely by installing Spring Security.

Study them through [the focused plan](Authentication-Authorization-Patterns.md#9-focused-study-plan-security-decisions-and-defenses). Return here only to map a required control to Spring.

## 10. Interview questions: the Spring-specific core

These are the questions to rehearse for Spring. Broader architecture questions are organized as scenarios in the companion guide. Numbering is intentionally compact rather than retaining the previous 23-question inventory.

### 10.1 Two security chains match. Do both run?

**Interview setup:** the API chain matches `/api/**`; a second chain matches every route. An API request matches both. Does it need to pass both chains, and what protects an unexpected route?

**Answer:** only the first matching chain runs; the fallback is not an extra authorization pass. Give the specific API chain higher precedence and make the catch-all policy deliberate. Test both API and unmatched routes so a chain gap does not expose endpoints.

```java
@Bean
@Order(1)
SecurityFilterChain api(HttpSecurity http) throws Exception {
    http.securityMatcher("/api/**");
    http.sessionManagement(session -> session
            .sessionCreationPolicy(SessionCreationPolicy.STATELESS));
    http.csrf(csrf -> csrf.disable());
    http.authorizeHttpRequests(auth -> auth.anyRequest().authenticated());
    http.oauth2ResourceServer(resource -> resource.jwt(Customizer.withDefaults()));
    return http.build();
}

@Bean
@Order(2)
SecurityFilterChain fallback(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(auth -> auth.anyRequest().denyAll());
    return http.build();
}
```

For `/api/orders/123`, both chain matchers match, but only the `@Order(1)` chain runs. For `/other`, only the catch-all chain matches and denies access. The fallback is not a second authorization pass after the API chain.

This assumes a configured JWT decoder with trusted issuer, audience and key/algorithm validation (section 8.4). The API is bearer-only with no browser-automatically attached credential fallback; that assumption, not JSON or JWT format, justifies disabling CSRF here. The fallback intentionally supplies no login UI. Add any public/probe exceptions deliberately.

### 10.2 A user was loaded. Why is authentication not complete?

**Interview setup:** a custom login looks up the username successfully and returns success even when the supplied password is wrong. What is missing?

**Answer:** finding the account is not credential verification. `UserDetailsService` supplies the stored user/password-hash information; the password authentication provider uses `PasswordEncoder` to check the presented password and account status. Prefer the supported provider rather than treating a successful database lookup as login.

```java
boolean matches = encoder.matches(presentedPassword, storedEncodedPassword);
```

The two-argument `UsernamePasswordAuthenticationToken` represents an unauthenticated request, not proof that the password passed. Compare using `matches`, not by encoding the supplied password again and comparing salted strings. A provider that does not handle the token type can defer; it must not grant access on failed verification.

### 10.3 When roles are supplied in a JWT, why might the API return 403?

**Interview setup:** the API accepts the token's signature and claims. It contains `roles: ["ADMIN"]`, yet an endpoint using `hasRole("ADMIN")` denies access. Why?

**Answer:** Spring checks granted authorities, not every raw claim automatically. `hasRole("ADMIN")` conventionally checks for `ROLE_ADMIN`; default JWT conversion commonly maps scopes to `SCOPE_...` instead. Configure the trusted role claim's conversion deliberately. Role assignment may also be application-managed rather than token-based.

```java
JwtGrantedAuthoritiesConverter roles = new JwtGrantedAuthoritiesConverter();
roles.setAuthoritiesClaimName("roles");
roles.setAuthorityPrefix("ROLE_");
JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
converter.setJwtGrantedAuthoritiesConverter(roles);
http.oauth2ResourceServer(resource -> resource.jwt(jwt ->
        jwt.jwtAuthenticationConverter(converter)));
```

This replaces default scope conversion; combine explicitly if both are required. Trust only validated claims. Correct mapping still does not override resource/tenant restrictions. A 403 can also reflect CSRF or another denial; inspect the actual path.

### 10.4 Does `@PreAuthorize` replace resource authorization?

**Interview setup:** every caller with `orders.read` can invoke `read(id)`. A user changes the ID and retrieves another tenant's order. Doesn't the annotation protect the method?

**Answer:** the annotation shown checks the capability to read orders, not ownership of the selected order. Enforce that relationship in the query/service rule or an explicit resource-aware permission expression. Enable method security, and ensure calls cross the proxy that applies its checks.

```java
@PreAuthorize("hasAuthority('SCOPE_orders.read')")
public OrderView read(Long id) {
    return loadAuthorizedOrder(id);
}
```

Here `loadAuthorizedOrder` must use trusted caller identity and membership, not a tenant value from the request. A call to `this.read(id)` bypasses proxy interception; test alternate entry points as well as the controller path.

### 10.5 Why does a custom login work only for the current request?

**Interview setup:** a custom controller verifies credentials and sets `SecurityContextHolder`. The login response succeeds, but the next request with the browser's cookie is anonymous. Why?

```text
Current request: set authenticated context → handler sees user
Next request: restore from context repository → nothing saved → anonymous
```

**Answer:** the holder supplies identity for the current execution; it does not automatically guarantee session persistence. Follow the configured session-authentication strategy and save the context through the configured repository, preferably using standard login handling. Also check that the browser sends the expected cookie and replicas can access the session. A stateless bearer API deliberately authenticates each request instead of saving login state.

### 10.6 How should Spring handle CORS and CSRF for an SPA?

**Interview setup:** a React frontend on a different origin cannot read API responses. After enabling CORS, cookie-authenticated POSTs still return 403. Are these the same failure?

The full explanation now lives in [Browser security: why CORS, CSRF and XSS happen](Authentication-Authorization-Patterns.md#10-browser-security-why-cors-csrf-and-xss-happen), including diagrams, request flows, defensive snippets and verification cases.

**Answer:** no. CORS controls cross-origin browser response access; CSRF checks protect state changes using automatically attached credentials. Configure trusted origins and preflight handling, then wire the session-based SPA's CSRF token delivery/submission/renewal using the supported Spring version recipe. A bearer-only API has different CSRF assumptions. `permitAll` does not fix either integration, and unexplained `csrf.disable()` can remove required protection.

### 10.7 Why does REST advice not format authentication failures?

**Interview setup:** controller exceptions use the application's JSON error contract, but missing-token responses do not pass through `@RestControllerAdvice`. Where should that formatting be configured?

```text
Request → security filters → rejection handlers
                     → if accepted: MVC controller → REST advice on MVC errors
```

**Answer:** authentication may fail before MVC is reached. Configure the relevant `AuthenticationEntryPoint` for authentication failures and `AccessDeniedHandler` for access denials. Preserve the meaningful 401/403 status and applicable `WWW-Authenticate` header; format safe JSON without exposing tokens or internal validation details. A CSRF rejection is not necessarily a missing role.

### 10.8 Which tests prove security beyond mocked permissions?

**Interview setup:** the following mocked-JWT test passes. Does it prove that the API rejects forged or wrong-audience tokens?

**Answer:** no; it supplies an authenticated principal rather than running cryptographic token verification. It is useful for endpoint/permission policy, but credential validation needs separate tests through the real bearer-token path.

```java
mockMvc.perform(get("/api/orders/123")
        .with(jwt().authorities(
                new SimpleGrantedAuthority("SCOPE_orders.read"))))
        .andExpect(status().isOk());
```

Use an existing permitted-order fixture for this positive policy test. Then send real signed fixture tokens through the Authorization header with isolated test keys, covering wrong audience/issuer, expiry, invalid signature and missing credentials. Cross-tenant tests must exercise resource policy; chain-gap tests must reach unexpected routes. Browser CORS behavior needs real-browser checks, not just mocked permissions.

## References and historical cautions

The PDF's fixed filter list, adapter-based configuration and universal session-default claims are historical. Provider `null` means deferral, not successful authentication; `STATELESS` does not mean cookie-free; "no cookies = no CSRF" is not a sufficient rule. Exact defaults and SPA recipes are version-dependent.

- [Servlet architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
- [Authentication architecture](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html)
- [Session/context management](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html)
- [CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)
- [CORS](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html)
- [JWT Resource Server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)
- [Opaque-token Resource Server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html)
- [OAuth2 Login](https://docs.spring.io/spring-security/reference/servlet/oauth2/login/core.html)
- [Method security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html)
- [Testing](https://docs.spring.io/spring-security/reference/servlet/test/index.html)
- [Security 6.5 preparation for 7](https://docs.spring.io/spring-security/reference/6.5/migration-7/configuration.html)
