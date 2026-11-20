# Testing Practices: Condensed Refresher (JUnit, Mockito, TDD)

> Written for a 20+ YOE candidate whose daily tool use has drifted but whose judgment hasn't. The goal here is not to relearn Mockito syntax line by line — it's to re-arm the vocabulary and the 3-4 judgment calls interviewers actually probe at this level, in one skim.

Companion guides: [Spring Core](Spring-Core-Notes.md), [Spring Boot](Spring-Boot-Notes.md).

## How this gets asked at senior level

Interviewers rarely ask you to write Mockito syntax from memory. They ask things like "how do you decide what to mock," "what's wrong with this test," or "how would you structure tests for this service" — judgment questions that assume you've done this for years and just want confirmation you still reason about it well. Spend 10 minutes here, not an hour.

## 1. The TDD cycle — in one breath

**Red → Green → Refactor.** Write a failing test that expresses the behavior you want, write the minimum code to pass it, then refactor with the safety net in place.

The interview-relevant point isn't the ritual — it's *why* it still matters at senior level: writing the test first forces an **interface decision** (what does calling this look like?) before an **implementation decision**. That's a cheap way to catch a bad abstraction (too many parameters, a class doing too much, an interface segregation violation) before it's built, not after. If asked "do you still do strict TDD," the honest senior answer is: not ritualistically, but the test-first *discipline for interface design* still shapes how you write new code, especially for anything with non-trivial branching or external dependencies.

## 2. Test pyramid — the judgment question

| Level | What it tests | Speed | When you reach for it |
|---|---|---:|---|
| Unit | One class/method in isolation, collaborators mocked | Fastest | Business logic, branching, edge cases |
| Integration | Real wiring across a few components (e.g. `@SpringBootTest` slice, real DB via Testcontainers) | Slower | Persistence mapping, Spring config, serialization boundaries |
| Contract | API/consumer-driven contract between services | Medium | Microservice boundaries, avoiding "integration test that only runs in CI" |
| End-to-end | Full stack, real-ish environment | Slowest | A handful of critical user journeys only |

**The senior-level trap question**: "your test suite is slow, what do you do?" Correct instinct — push the weight toward the bottom of the pyramid (more unit, fewer E2E), not just "run tests in parallel." A suite that's mostly integration/E2E is a maintainability smell, not just a speed problem.

## 3. Mockito — just enough to write one on a whiteboard

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock
    PaymentGateway paymentGateway;          // collaborator, faked

    @InjectMocks
    OrderService orderService;              // class under test, mocks injected

    @Test
    void chargesCustomerOnValidOrder() {
        when(paymentGateway.charge(any(Order.class)))
            .thenReturn(PaymentResult.success());

        OrderResult result = orderService.place(new Order(...));

        assertThat(result.isConfirmed()).isTrue();
        verify(paymentGateway).charge(any(Order.class));   // interaction happened
    }

    @Test
    void doesNotChargeOnInvalidOrder() {
        OrderResult result = orderService.place(new Order(/* invalid */));

        assertThat(result.isConfirmed()).isFalse();
        verifyNoInteractions(paymentGateway);               // interaction did NOT happen
    }
}
```

Core vocabulary to have ready:

- **`@Mock`** — a fake with no real behavior until stubbed. **`@Spy`** — wraps a real object; real methods run unless you stub them. Use a spy only when you need most of the real behavior and want to override one method (rare; often a sign the design should be split instead).
- **`when(...).thenReturn(...)`** — stubbing: "when this is called, return this." **`verify(...)`** — asserting an interaction happened (and optionally how many times: `verify(x, times(2))`, `never()`).
- **`ArgumentCaptor<T>`** — capture what was actually passed to a mock, to assert on it, instead of just matching `any()`. Reach for this when the *content* of the call matters, not just that it happened.
- **Stubbing vs. mocking vs. faking** (interview vocabulary gap): a **stub** returns canned answers; a **mock** additionally lets you *verify* interactions; a **fake** is a lightweight working implementation (e.g. in-memory repository) used instead of a real one. Mockito gives you stubs+mocks; you write fakes by hand when a real in-memory version is cheaper than mocking every method.

## 4. Gotchas senior candidates get asked about

- **Don't test private methods directly.** If a private method's logic is complex enough to need its own test, that's a signal it should be extracted into its own (tested) collaborator — not a reason to reach for reflection.
- **Over-mocking is a design smell, not just a test smell.** A test that needs to mock five collaborators to exercise one method usually means the class has too many responsibilities. The fix is often back in the production code (split the class), not in the test.
- **Flaky tests** most often come from: shared mutable state between tests (missing `@BeforeEach` reset or static state), real time/clock dependence (inject a `Clock` instead of calling `Instant.now()` directly), unordered collections asserted with ordered equality, and real network/DB calls leaking into what should be a unit test.
- **Don't assert on mock-call counts as the primary assertion.** Assert on observable behavior/outcome first (`result.isConfirmed()`), and use `verify` to confirm a *necessary* side effect happened — not as a substitute for checking the actual result.

## 5. Which annotation for which test (ties back to Spring Core/Boot)

- **Plain Mockito test** (no Spring context) — fastest, default choice for service/business-logic classes with mocked collaborators.
- **`@WebMvcTest`** — loads only the web layer (controller + filters), mocks the service layer via `@MockBean`/`@MockitoBean`. Use when testing request mapping, validation, serialization, status codes.
- **`@DataJpaTest`** — loads only the JPA/repository layer with an embedded or Testcontainers DB. Use for query correctness, not business logic.
- **`@SpringBootTest`** — full application context. Slowest; reserve for a small number of true integration tests, not as the default for everything.
- A plain **JUnit Jupiter + Spring TestContext** test (`@SpringJUnitConfig`, no full Boot context) is the lighter-weight option when you need real wiring (qualifiers, proxies, lifecycle) but not the whole Boot auto-configuration stack — see the Spring Core container-test example.

## 6. One-line answers for common prompts

- *"What's the difference between a mock and a stub?"* — A stub just returns canned values; a mock additionally lets you verify interactions occurred.
- *"How do you decide what to mock?"* — Mock things with real-world side effects or non-determinism (I/O, network, time, randomness) or that are slow/expensive; don't mock simple value objects or the class under test's own internals.
- *"TDD vs. test-after — which do you do now?"* — Test-first for anything with non-trivial branching or a new public interface (it's a cheap design review); test-after is fine for straightforward CRUD/plumbing where the design isn't really in question.
- *"Continuous Delivery and testing — how do they connect?"* — A fast, trustworthy (non-flaky) test suite is the actual enabler of CD; if the suite is slow or flaky, teams route around it (skip tests, batch releases), which defeats the point.
