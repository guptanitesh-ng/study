# Spring Security: Interview Notes

Reviewed: October 31, 2026. Source: the five-page Spring Security PDF, dated August 16, 2019; its last page contains references to a separate finance application.

This editorial Markdown conversion keeps the architectural concepts, replaces removed APIs/unsafe simplifications, and adds modern authorization/OAuth2/testing coverage. It is not a verbatim transcript or a runnable security configuration. The external finance-application examples and PDF diagrams are not reproduced; their behavior cannot be inferred from their names.

Study sequence: [Core](Spring-Core-Interview-Notes.md) -> [Boot](Spring-Boot-Interview-Notes.md) -> [REST + MVC](Spring-REST-MVC-Interview-Notes.md) -> [Data](Spring-Data-Interview-Notes.md) -> **Security**.

## Relevance and original-topic coverage

| PDF pages | Original coverage | Assessment |
|---|---|---|
| 1 | Servlet filter architecture, adapter-based configuration | Architecture remains valuable; adapter/configuration recipes are obsolete. |
| 2-3 | AuthenticationManager, providers, user details, remember-me | Keep concepts; fix provider contracts, roles/password examples and remember-me assumptions. |
| 3 | Sessions, context persistence, fixation protection | Essential; statelessness guarantee and historical defaults are misleading. |
| 3-4 | CORS, CSRF, logout | Essential; "no cookies = no CSRF" is not a sufficient security rule. |
| 5 | External LogoutFilter/SecurityContext examples | Replace missing references with self-contained conceptual coverage below. |

## 1. Servlet security architecture

```text
Servlet container filter chain
  -> DelegatingFilterProxy
  -> FilterChainProxy
  -> first matching SecurityFilterChain
  -> authentication / exploit protection / authorization filters
  -> remaining Servlet filters and mapped Servlet
```

`DelegatingFilterProxy` bridges Servlet registration to a Spring-managed filter, typically the `springSecurityFilterChain` bean. `FilterChainProxy` selects the first matching `SecurityFilterChain`. It does not run every matching chain.

Filter order matters, but do not memorize the PDF's historical ten-filter inventory as a universal current chain. The actual chain depends on configured features and version. Modern request authorization commonly uses `AuthorizationFilter`, not the old `FilterSecurityInterceptor` recipe.

Boot can register the bridge automatically; `@EnableWebSecurity` by itself is not a generic replacement for Servlet filter registration in every deployment.

**Added:** when multiple chains exist, distinguish the chain's `securityMatcher` from authorization `requestMatchers` within it. A request matching no chain is not protected by those chains; design a deliberate catch-all policy.

WebFlux uses a separate reactive security chain (`SecurityWebFilterChain`), not Servlet filters.

## 2. Modern configuration

**Replace**, do not copy, these historical recipes:

| PDF API / pattern | Modern direction |
|---|---|
| Extend `WebSecurityConfigurerAdapter` | Declare a `SecurityFilterChain` bean. The adapter was removed in Security 6. |
| `@EnableWebMvcSecurity` | Use supported web-security configuration; this annotation is obsolete. |
| `.authorizeRequests().and()` chains | `authorizeHttpRequests` with the lambda DSL; the lambda style is required for Security 7 configuration. |
| `javax.servlet.*` | `jakarta.servlet.*` on the modern stack. Do not rename unrelated Java SE `javax` packages. |
| Hardcoded sample passwords | An appropriate adaptive `PasswordEncoder` and externally provisioned/test-only identities. |
| `.roles("ROLE_ADMIN")` | Typically `.roles("ADMIN")`, or explicit `.authorities("ROLE_ADMIN")`; do not duplicate the role prefix. |

A conceptual Servlet configuration shape:

```java
@Bean
SecurityFilterChain webSecurity(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(auth -> auth
        .requestMatchers("/public/**").permitAll()
        .anyRequest().authenticated());
    http.formLogin(Customizer.withDefaults());
    return http.build();
}
```

This is an illustrative fragment, not a complete application: imports, identity provisioning, session/CSRF policy and precise public endpoints must be chosen for the use case. CSRF remains enabled by default here. A bearer-token API needs a different authentication arrangement.

Do not rely on Boot's generated development credentials or default policy as a production design.

## 3. Authentication contracts

**Authentication** establishes identity; **authorization** decides whether that identity may perform an action on a specific resource.

- An authentication filter extracts credentials and constructs a request `Authentication`.
- `AuthenticationManager` authenticates that request. `ProviderManager` is a common implementation coordinating compatible providers.
- `AuthenticationProvider.supports` declares supported token types.
- A provider may return a successful `Authentication`, throw an authentication exception, or return `null` to let another provider try. `null` is not a "confused state".
- The manager's contract is a successfully authenticated result or failure; do not generalize the provider's `null` option to the manager.
- `UserDetailsService` loads user details; it does not itself validate the presented password. A password-based provider commonly combines it with a `PasswordEncoder`.

Provider ordering matters, but the PDF's "any error-free return stops every subsequent provider" is wrong: `null` permits continuation, and particular exception/provider behavior matters.

`GrantedAuthority` is a permission label; role conventions commonly use `ROLE_`. OAuth scopes commonly map to `SCOPE_` authorities, not automatically to application roles.

A custom provider is for a genuine custom mechanism. Prefer established password, OAuth2, OIDC or certificate integrations when appropriate. Never compare plaintext credentials to hardcoded strings in production or retain credentials unnecessarily.

## 4. SecurityContext and sessions

`SecurityContext` contains the current `Authentication`. Servlet applications commonly use a thread-local `SecurityContextHolder`; context must be cleaned up after request processing.

Authentication persistence across requests uses a `SecurityContextRepository`. In modern setups, setting the holder is not automatically equivalent to explicitly persisting authentication. Custom authentication code must follow the configured save mechanism.

Security 6 changed defaults: `SecurityContextHolderFilter` commonly replaces the older persistence-filter arrangement, and `SessionManagementFilter` is not installed by default. Do not extrapolate the PDF's exact filter inventory.

| SessionCreationPolicy | Security's intent |
|---|---|
| `ALWAYS` | Create a session. |
| `IF_REQUIRED` | Create when needed. |
| `NEVER` | Do not create, but may use an existing session. |
| `STATELESS` | Do not create or use an HTTP session for storing/retrieving the SecurityContext. |

**Critical correction:** `STATELESS` does not guarantee no other application code creates sessions or cookies. It does not mean an API is automatically CSRF-safe.

Session fixation protection prevents continuing an attacker's known session identity after login. Modern Servlet containers commonly use `changeSessionId`; the PDF's universal `migrateSession` default is historical. Discuss fixation, expiration, concurrent sessions and logout separately.

For async work, deliberately propagate authorized context where appropriate; do not assume arbitrary new threads inherit it. Reactive security uses Reactor context. A long-running task should not retain stale authorization indefinitely.

## 5. Remember-me and logout

Remember-me is persistent re-authentication, not simply an indefinitely valid login session. Supported mechanisms include token-based and persistent-token arrangements. Protect tokens, choose lifetimes, consider revocation/theft, and require stronger authentication for sensitive operations.

Do not copy `alwaysRemember(true)` from the old sample as a default, or combine it with a stateless policy without explaining how the mechanism works. A remember-me cookie is still browser-supplied authentication material.

Logout can clear the holder/repository, invalidate an application session, and remove relevant cookies/tokens according to configuration. With CSRF protection, POST is normally the state-changing logout action; a GET may serve a confirmation page.

An API's JWT logout is different: deleting a browser token does not revoke every copy of an already-issued JWT. Explain expiration, refresh-token revocation and server-side revocation strategies when required.

## 6. CORS: browser permission, not authorization

CORS controls whether browser JavaScript may access cross-origin responses. It does not authenticate callers or prevent non-browser clients from sending requests.

- Only some cross-origin requests require a preflight; the PDF incorrectly implies all do.
- Handle CORS before authentication that would reject preflight requests without credentials.
- Configure explicit trusted origins, methods and headers as appropriate.
- `Access-Control-Allow-Origin: *` is incompatible with credentialed cross-origin response access. Do not describe the wildcard as proof that the browser never sends credentials at all.
- A simple cross-origin request can reach the server even when JavaScript cannot read its response. CORS is not a replacement for CSRF protection.

Use Spring MVC/Security CORS integration consistently. Do not reflect arbitrary origins while allowing credentials.

## 7. CSRF and XSS

CSRF exploits credentials the browser attaches automatically to induce an unwanted state-changing request. Cookie sessions are common, but browser-managed HTTP authentication is also relevant. Therefore **"no cookies = no CSRF" is too broad**.

Decide based on the credential transport and client behavior:

| Arrangement | Study guidance |
|---|---|
| Browser session/remember-me cookies | Preserve appropriate CSRF protection for unsafe actions. |
| Browser-automatically supplied authentication | Analyze CSRF risk even without session cookies. |
| API bearer header explicitly set by the client, no ambient credential fallback | CSRF may not apply in the same way; document assumptions before disabling it. |
| Bearer token moved into an authentication cookie | Re-evaluate CSRF; JWT format does not eliminate browser credential behavior. |

Spring Security protects unsafe methods by default. Safe methods must not perform intentional state changes.

CSRF protection uses a token repository and request handler, with session and cookie repositories available. A token sent back automatically only as a cookie is not proof of a legitimate action; request validation typically requires the submitted header/form token as well.

Modern Security defers token loading and applies BREACH-related handling. The old "CSRF always immediately creates a session" statement is not a universal description.

For SPAs, follow the current framework recipe, including token lifecycle after login/logout. A readable CSRF cookie may be necessary for a JavaScript integration; that is not a reason to make the authentication/session cookie readable.

XSS and CSRF are distinct. XSS can often compromise CSRF defenses, but CSRF does not require XSS. Defend rendered content with appropriate output encoding and related controls; CORS does not prevent same-origin malicious script from reading accessible data.

## 8. Added essentials missing from the PDF

**Request and method authorization:** explicit defaults, `@EnableMethodSecurity`, `@PreAuthorize` where appropriate, proxy boundaries, and object/tenant ownership checks. A role-only check does not prevent one user accessing another user's record.

**OAuth2/OIDC:** distinguish an authorization server, OAuth client and resource server. OAuth2 is an authorization framework; OIDC adds an identity layer. Know authorization code with PKCE, service-to-service client credentials and bearer-token handling.

**JWT versus opaque tokens:** JWT resource servers verify signatures and validate relevant claims; opaque tokens commonly use introspection. Configure issuer, audience and authority mapping for the application; decoding a token is not validating it. JWT is not automatically encrypted or immediately revocable.

**Passwords/secrets:** adaptive hashing, encoder compatibility, credential rotation, TLS, secure cookie settings and no sensitive logging.

**Failure responses:** `AuthenticationEntryPoint` for unauthenticated failures and `AccessDeniedHandler` for access denial. Typical API outcomes are 401 versus 403; form login may redirect. MVC advice does not catch every filter-level failure.

**Tests:** Spring Security test support, authenticated/anonymous cases, wrong role/scope, CSRF tokens, chain matching, CORS preflight, invalid/expired issuer/audience tokens and cross-tenant access. Mock identities do not prove real token signature validation; include integration tests for that path.

## 9. 2026 and AI-age application security

For AI features, preserve the same authorization boundaries:

- Retrieved documents must obey caller/tenant permissions before reaching the model.
- Model-proposed tool calls are untrusted requests, not grants of authority.
- Authorize each operation in application code; validate schema and business rules; require explicit approval for consequential actions where appropriate.
- Do not let prompt text supply identity, role, tenant or arbitrary query/command authority.
- Treat MCP as an integration protocol, not a replacement for authentication/authorization. Apply least privilege, transport security and the appropriate current authentication model.
- Protect tokens, prompts, retrieved sensitive content and audit records. Use safe telemetry and cost/rate budgets.

AI-generated `SecurityFilterChain` examples deserve the same review as human-written ones. Watch especially for blanket `permitAll`, broad matcher gaps and unexplained `csrf.disable()`.

## 10. Interview drills

- Two chains match an API URL. Which runs, and what if neither matches?
- `UserDetailsService` finds a user. Why is authentication not complete yet?
- A stateless API still sets cookies. Explain what the policy actually controls.
- A CORS-rejected POST changed data. Explain response access versus request execution.
- A JWT signature is valid but its audience is wrong. Explain why access should still fail.
- A service has `@PreAuthorize` but calls itself internally. Explain proxy boundaries.
- A model asks to read another tenant's document. Identify the authorization boundary.

## Change references

**Version change** identifies changed APIs/defaults; **correction** identifies an inaccurate original claim; **addition** identifies missing coverage. Locations refer to PDF pages. References were checked during the October 31, 2026 review; current URLs may later advance.

| Original location / claim | Category and correction | Official evidence |
|---|---|---|
| pp. 1-3: WebSecurityConfigurerAdapter recipes | Version change: component-based SecurityFilterChain configuration; adapter deprecation began in 5.7 and is not a modern API. | [Official adapter migration article](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter) |
| pp. 1-3: chained non-lambda DSL | Version change: lambda configuration is required for Security 7, not simply a style preference. | [Version-pinned Security 6.5 preparation for 7](https://docs.spring.io/spring-security/reference/6.5/migration-7/configuration.html) |
| p. 1: fixed ten-filter list / all matching filters | Qualification: configured features determine filters; FilterChainProxy selects the first matching chain. | [Servlet security architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html) |
| p. 2: null means confused authentication; p. 3: every error-free provider stops lookup | Correction: providers can return null to defer; the manager returns successful authentication or throws on failure. | [AuthenticationProvider API](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/authentication/AuthenticationProvider.html) and [AuthenticationManager API](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/authentication/AuthenticationManager.html) |
| p. 2: roles with ROLE_ prefix / hardcoded password | Correction: role helpers add the prefix; use properly encoded/provisioned credentials. | [In-memory users](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/in-memory.html) and [password storage](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html) |
| p. 3: STATELESS guarantees no application session | Correction: SecurityContext session policy does not control every application component. | [Session management](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html) |
| p. 3: persistence/session filters always default; migrateSession always default | Version-aware correction: Security 6 defaults changed, explicit saving matters for custom auth, modern containers support changeSessionId. | [Session/context persistence and fixation](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html) |
| pp. 3-4: every cross-origin request preflights; wildcard prevents any credential sending | Correction: browser CORS processing is conditional; response-access rules are not server authorization. | [Spring Security CORS](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html) and [Spring MVC CORS](https://docs.spring.io/spring-framework/reference/web/webmvc-cors.html) |
| p. 4: "No cookies = No CSRF" | Correction, not new in 2026: browser-automatically supplied credentials can include other mechanisms; analyze transport. | [CSRF attack model and stateless browser applications](https://docs.spring.io/spring-security/reference/features/exploits/csrf.html) |
| p. 4: enabling CSRF always creates a session immediately | Version change/qualification: deferred token loading in Security 6, repository choice and SPA lifecycle matter. | [CSRF components and 5-to-6 changes](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html) |
| pp. 3, 5: remember-me/logout references | Expansion: persistent authentication and logout cleanup differ from JWT revocation. | [Remember-me](https://docs.spring.io/spring-security/reference/servlet/authentication/rememberme.html) and [logout](https://docs.spring.io/spring-security/reference/servlet/authentication/logout.html) |
| OAuth2/JWT and method authorization absent | Addition: token validation/authority mapping and service authorization belong in modern preparation. | [JWT resource server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) and [method security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) |

Older migration articles are retained to explain history, not as copy-paste configuration for every modern version.

## Official references

- [Servlet security architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
- [Authentication architecture](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html)
- [Session/context management](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html)
- [CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)
- [CORS](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html)
- [JWT resource servers](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)
- [Method security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html)
- [Spring Security testing](https://docs.spring.io/spring-security/reference/servlet/test/index.html)
- [Spring AI / MCP](https://docs.spring.io/spring-ai/reference/index.html)

These links track current documentation. Match Security 6/7 APIs and defaults to the actual Boot/framework generation before using a recipe.
