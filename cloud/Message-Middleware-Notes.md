# Message Middleware: JMS, MDBs and the Kafka Gap

Reviewed: November 19, 2026. Source: personal JMS/MDB notes covering message anatomy, acknowledgment/transaction modes, persistent/durable semantics, request-reply, JMS 2.0 features, message selectors, and ActiveMQ virtual topics vs. composite destinations.

**Context that shapes this file:** 20+ years hands-on with ActiveMQ, RabbitMQ, and IBM MQ — mostly through legacy EJB MDBs — but no production Kafka experience, which is now the de-facto expectation in interviews. This is explainable, not disqualifying: Kafka adoption accelerated well after the EJB/MQ-heavy era most JMS experience comes from. The content below is deliberately organized as a **bridge** — JMS/MQ concept first (where the existing depth already is), Kafka equivalent second, and the real difference that trips people up third. That structure is also the one to use in the interview itself: lead with depth, map it forward, don't fake Kafka production history.

Related: [Spring Boot](../spring/Spring-Boot-Notes.md) (where `@JmsListener`/`@KafkaListener` fit), [REST + MVC](../spring/Spring-REST-MVC-Notes.md#request-reply) (sync alternatives to request-reply messaging).

## 1. JMS and MDB fundamentals — mechanics behind the interview answer

### 1.1 Message anatomy and grouping

**Scenario: "Why did we process the same payment twice?"** A JMS message has **headers** such as `JMSMessageID`, `JMSCorrelationID`, `JMSReplyTo`, `JMSDeliveryMode`, `JMSExpiration`, `JMSPriority` and `JMSRedelivered`; application **properties** can carry routing metadata; the **body** holds the payload. `JMSRedelivered=true` suggests possible earlier delivery, not proof of where or why it failed. Inspect the business idempotency key, logs and `JMSXDeliveryCount` too: a consumer might have committed a database update and crashed before acknowledgment.

Bodies include `TextMessage`, `BytesMessage`, `MapMessage`, `StreamMessage` and `ObjectMessage`. **Why avoid `ObjectMessage` across independently deployed services?** Java serialization couples both ends to compatible classes and object graphs; an agreed text or binary schema is often easier to evolve and use across languages. This is a trade-off, not a claim that only two JMS body types are valid. A received message's body and properties are read-only; `clearBody()` or `clearProperties()` clears the respective content before it can be rewritten.

**Follow-up: "How do multiple consumers process each account's events in order?"** Set an account identifier in `JMSXGroupID`. For example, ActiveMQ Classic's message groups normally assign a group to one consumer while it stays alive; different groups can be processed in parallel, and a group can be reassigned after consumer failure. Classic can close a group with a negative `JMSXGroupSeq`. Verify the provider's grouping implementation and configuration, including failover, cache limits and application concurrency; the property alone is not a universal end-to-end ordering guarantee. Kafka keys serve a related purpose, but their partition and offset mechanics differ. [ActiveMQ Classic message groups](https://activemq.apache.org/components/classic/documentation/message-groups).

**Topology follow-up: "Where does the broker run?"** An application server may host an embedded broker/provider, or its JMS resource adapter may connect to an external broker shared by several applications. In either case, producers send to a destination and the provider delivers to consumers such as MDBs; an MDB is not itself the broker. An embedded deployment couples broker lifecycle and capacity to the host; an external deployment adds network, independent operations and availability concerns. Neither placement alone guarantees persistence, atomicity or high availability—verify the actual storage, transaction and HA configuration.

### 1.2 Acknowledgment and MDB transaction boundaries

For a **plain, non-transacted JMS session**, no-argument `connection.createSession()` defaults to `AUTO_ACKNOWLEDGE`; an explicitly selected mode overrides it. The table describes JMS session behavior, not every listener container:

| Mode | When it takes effect | Failure / trade-off |
|---|---|---|
| `AUTO_ACKNOWLEDGE` | After synchronous `receive()` returns, or after a standard asynchronous JMS listener returns successfully | For `receive()`, application processing happens **after** acknowledgment; a crash before its durable side effect can lose work. |
| `CLIENT_ACKNOWLEDGE` | `message.acknowledge()` acknowledges all messages consumed so far in that session | Acknowledgment is session-scoped, not just for that message; unacknowledged work can be redelivered. |
| `DUPS_OK_ACKNOWLEDGE` | Provider may acknowledge lazily | Redelivery and duplicates are possible; make processing idempotent. |
| Transacted session (`SESSION_TRANSACTED`) | Consumed messages and sends in the JMS transaction commit or roll back together | A separate database is not automatically enlisted; rollback can cause redelivery. |

**MDB interview follow-up: "Is `AUTO_ACKNOWLEDGE` the default?"** It is a common activation setting for non-transactional delivery, but the effective behavior depends on transaction configuration:

- **Container-managed `REQUIRED`** is the normal EJB 3+ default. The container starts a JTA transaction around message consumption and `onMessage`; successful commit acknowledges consumption. A rollback, for example after an unchecked exception escapes, makes the message eligible for redelivery under the provider's policy. A database participates atomically only if it and the messaging resource are properly enlisted, commonly via XA.
- **Container-managed `NOT_SUPPORTED`:** no container-managed JTA transaction surrounds the listener. Non-transactional acknowledgment and failure behavior depend on the container/provider; don't assume that every failure either loses or redelivers the message. IBM documents syncpoint-dependent outcomes for WebSphere/MQ.
- **Bean-managed:** a user transaction started *inside* `onMessage` does not include receipt of that incoming message. Do not assume it makes receipt and the database update atomic.

**Concrete failure:** an MDB writes a payment row then crashes. With correctly enlisted XA resources and rollback, both consumption and the database update roll back. Without a shared transaction, the row can commit while the message is redelivered, so an idempotency key protects the business operation. Catching an exception and returning normally can also let a transaction commit unless it is marked rollback-only; a DLQ/redelivery limit must be configured and verified.

**Spring distinction:** Spring Boot's auto-configured `@JmsListener` factory is transactional by default (JTA when available, otherwise a transacted JMS session); a custom factory can differ. A non-transacted Spring `DefaultMessageListenerContainer` using `AUTO_ACKNOWLEDGE` acknowledges before listener execution, unlike a standard JMS asynchronous callback. [Spring Boot JMS](https://docs.spring.io/spring-boot/reference/messaging/jms.html) · [Spring listener container](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/jms/listener/AbstractMessageListenerContainer.html) · [IBM MDB transactions](https://www.ibm.com/docs/ro/was-nd/8.5.5?topic=retrieval-message-driven-beans-transaction-support).

### 1.3 Persistent messages vs. durable subscriptions

**Question: "The consumer was down during an outage. Will it get the message?"** Persistence is a **message delivery mode**; durability is a **topic subscription** property. Neither is the same as a consumer acknowledgment.

| Destination / subscription | `NON_PERSISTENT` | `PERSISTENT` |
|---|---|---|
| Queue | May be held for an offline consumer but can be lost on provider failure | Intended to survive provider failure with correctly configured durable storage; retained pending consumption, expiry or policy |
| Non-durable topic subscription | No backlog while the subscription is inactive | Persistence doesn't create an offline subscription backlog |
| Existing durable topic subscription | Delivery while inactive or after provider failure is not guaranteed | Matching messages can be retained while inactive, subject to expiry, deletion and provider/storage policies |

A durable subscription must already exist when messages are published; it isn't a replay of earlier topic history. Persistent delivery is not a guarantee of exactly-once **business processing**: redelivery after an unacknowledged side effect is possible. Check expiration, storage, HA and broker limits rather than assuming “persistent” solves every failure.

### 1.4 Request–reply, temporary destinations and correlation

**Scenario:** an online service sends a request and needs its corresponding response. It sets `JMSReplyTo` to either a known reply queue or a temporary queue; the responder sends there. One correlation convention is to put an application-generated ID in the request's `JMSCorrelationID` and copy it to the reply. Another is to copy the request's `JMSMessageID` into the reply's `JMSCorrelationID`. On a shared reply queue, a selector or application-side dispatcher can match replies to pending requests; a selector per request is not mandatory.

A temporary queue/topic belongs to its creating connection and disappears when deleted or the connection closes; only consumers on that connection can consume from it, while other clients can send to it using `JMSReplyTo`. A known reply queue survives connection loss according to its configuration but needs correlation and cleanup. The legacy `QueueRequestor` hides temporary-queue setup, but its `request()` has no timeout argument; assess that limitation rather than waiting indefinitely. Even with an explicit timeout, the request might still execute later—retry safely with an idempotency key.

### 1.5 Selectors, backlog and queue design

Selectors use a SQL-like expression on eligible JMS headers and message properties, not the body. For example, a consumer selector `orderType = 'ONLINE'` matches an application property. On a queue, messages that match no available consumer can remain pending until an eligible consumer arrives, they expire, or policy handles them; a missing property can make a selector evaluate as unknown.

**Scenario:** 400 batch book orders are ahead of an online order. A single shared queue and listener pool can delay the online customer even though the message schemas are identical. Separate queues and independently sized consumers can isolate the workloads; a shared queue with selectors offers consumer-controlled filtering and may reduce producer routing knowledge, but adds selector and backlog management. Provider implementation, queue depth and selectors affect performance—measure on the actual broker rather than assuming a universal CPU formula.

**Why not just set priority?** A high-priority message cannot preempt workers already processing low-priority work, and JMS priority is not a strict scheduling guarantee. Use separate capacity where latency isolation matters. A `QueueBrowser` lets operators inspect messages without consuming them, but it is not a transactionally consistent or necessarily static snapshot.

### 1.6 Expiration, priority and API evolution

**Common bug:** setting `message.setJMSExpiration(...)` or `setJMSPriority(...)` before sending can be overwritten by the provider. Set **time-to-live** and priority on the producer or on the send operation instead. For example, in the JMS 2.0 simplified API:

```java
context.createProducer()
       .setTimeToLive(30_000) // milliseconds; 0 means no expiration
       .setPriority(9)
       .send(queue, body);
```

The provider calculates `JMSExpiration` from TTL and the send time; for a transacted send, that is not necessarily the commit time. A message can therefore expire while waiting for commit or a consumer. Confirm expiry handling and DLQ policy with the provider.

**JMS 2.0 additions:** delivery delay, shared durable and non-durable subscriptions, the `JMSContext` simplified API, asynchronous send in supported environments, and mandatory provider support for `JMSXDeliveryCount`. Modern Jakarta Messaging uses `jakarta.jms`; older JMS applications use `javax.jms`. [Jakarta Messaging specification](https://jakarta.ee/specifications/messaging/3.0/jakarta-messaging-spec-3.0.html).

**Shared-subscription follow-up:** billing and analytics each need their own copy of an event, while billing needs multiple workers. Give each system its own subscription and let billing workers share its subscription: workers compete for billing's copy, not one copy per worker. Make the subscription durable and provision it before publication if offline retention is required; expiration, broker policy and failures still apply. A non-durable shared subscription does not provide an offline backlog after all its consumers disconnect.

**Async-send follow-up:** a successful return from the call does not mean the send has completed; use the `CompletionListener` success/failure callback and don't mutate or reuse the message before completion. Check the specification and container/provider restrictions before using asynchronous send in managed environments; commit/close and failure handling still matter.

## 2. ActiveMQ virtual topics vs. composite destinations

This is the kind of detail a vendor-agnostic Kafka-only candidate can't answer, so it's worth having ready as a "here's something specific I've actually operated" moment — the scenario that surfaces it in an interview is "a new consumer team needs a copy of future order events, how do you add them without touching the producer or redeploying anything":

- **Virtual topic:** producer sends once to a topic; ActiveMQ fans it out to per-system queues (`Consumer.A.VirtualTopic.Foo`, `Consumer.B.VirtualTopic.Foo`, ...) — dynamic, broker-managed fan-out, with competing consumers sharing each queue. A new team can create its queue without changing the producer; the queue must exist when a message is published to receive its copy.
- **Composite destination:** a *static*, explicitly configured list of destinations receives copies of a send. The mapping can be configured at the producer or on the broker; adding a destination requires changing that mapping, not necessarily redeploying the producer.

The practical difference: virtual topics allow new system queues to be added under the naming convention; composite destinations require an explicit mapping change.

**Relevance today:** virtual topics are less essential for new JMS 2.0 designs: a regular topic with a separate shared durable subscription per system can provide fan-out, offline retention and competing consumers. Virtual topics remain useful in existing ActiveMQ Classic deployments or when teams specifically want queue-based operations and semantics. They are an ActiveMQ-specific option, not a requirement for topic fan-out.

## 3. The JMS -> Kafka bridge — concept by concept

| You know (JMS/MQ) | Kafka comparison | The difference that actually bites |
|---|---|---|
| Queue with competing consumers | One consumer group on a topic | A partition is assigned to one group member at a time; retries/rebalances can still repeat processing. The log isn't removed on acknowledgment. |
| Topic subscriptions / virtual-topic queues | Multiple consumer groups | Each group maintains an independent position; records are available only within the topic's retention and compaction rules. |
| Durable subscription | Group offsets plus retained records | A group's offset is a resume position, not a promise to retain records until it catches up. Expiry or compaction can remove them first. |
| `AUTO_ACKNOWLEDGE` | Periodic auto-commit | Both can leave a loss window if progress is recorded before work finishes, but timing differs. With Kafka, auto-commit safety depends on processing the polled batch before subsequent polls or closure; asynchronous workers need special care. |
| `CLIENT_ACKNOWLEDGE` | Manual offset commit | Both let the application control progress, but JMS acknowledgment covers consumed messages in a session; Kafka commits the **next** offset per partition, covering earlier offsets too. |
| Transacted JMS session / JTA | Kafka transactions | Kafka can atomically commit produced Kafka records and consumed offsets when configured for consume-transform-produce; `read_committed` hides aborted transactional records. This does not automatically include an external database or payment API. JTA/XA has different resource boundaries. |
| MDB rollback and redelivery | Offset recovery plus application/framework error handling | Not committing a failed record does **not** make the next `poll()` automatically replay it in the same running consumer: its in-memory position already advanced. Seek/retry, framework error handling or restart/rebalance can re-read; don't commit past unfinished work accidentally. |
| JMS selector | Application filtering or separate topics | Kafka consumers normally read records and filter in the application. A key chooses a partition; it is not a broker-side selector or subscription filter. |
| Request–reply using `JMSReplyTo` | Reply topic and correlation | Possible, but adds correlation, timeouts and operational complexity; choose messaging or HTTP/gRPC based on actual requirements rather than assuming either is always right. |
| JMS priority | No general per-message broker priority | Separate topics and consumer capacity can provide isolation; separate partitions alone do not automatically prioritize consumption. |

**Failure walkthrough:** a Kafka consumer polls offsets 10–12 and fails at 11. Its in-memory position may already be 13. Merely withholding a commit doesn't rewind it: configure a seek/retry or stop and resume from a safe committed offset, and don't commit 13 while 11 is unresolved. A retry or DLQ topic is one option, but deciding when to advance the source offset requires a reliable publish/error-handling strategy. Framework defaults differ.

**Exactly-once boundary:** Kafka's transactional consume-transform-produce pattern requires coordinating the input offsets with output writes in the Kafka transaction, and downstream consumers using `read_committed`. If input itself is transactional, consume it with `read_committed` too to avoid processing aborted records. Idempotent producer settings or `read_committed` alone do not give an external database or payment API exactly-once side effects. Design those separately with idempotency, transactional state or another suitable pattern. [Kafka consumer API](https://kafka.apache.org/40/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html) · [Kafka transactions](https://developer.confluent.io/learn/kafka-transactions-and-guarantees/).

## 4. Closing the gap — a concrete plan

1. **Hands-on, this weekend, using an app you already have:** `docker-compose` up a single-broker Kafka (KRaft mode, no Zookeeper needed), add Spring Kafka to one of your existing Spring Boot apps, and build: a producer, a consumer with manual ack (`AckMode.MANUAL`), an idempotent-producer config, and a retry-topic + DLQ pattern for a message that throws. Then run two consumer instances in the same group against a multi-partition topic and watch partition rebalancing happen live — that single exercise answers three common interview questions at once.
2. **Lock in the vocabulary you don't have yet:** broker, partition, offset, consumer group, replication factor, ISR (in-sync replicas), leader/follower, producer `acks` levels (`0`/`1`/`all`), idempotent producer, transactions, Kafka Streams/Connect (awareness-level), Schema Registry + Avro (backward/forward compatibility) if your target role does event-driven integration.
3. **Rehearse the handful of questions that actually get asked:**
   - *"Why does partition key design matter?"* — ordering is guaranteed only within a partition; a bad key choice creates a hot partition and starves parallelism.
   - *"How do you handle a poison message?"* — check the MDB transaction and broker redelivery/DLQ policy; in Kafka configure seek/retry or error-handler behavior, and only advance a safe offset when the failure is resolved or reliably handled.
   - *"How do you get exactly-once in Kafka vs. a transacted JMS session?"* — first define the boundary: Kafka output and consumed offsets can be atomic in a Kafka transaction; JMS plus a database requires correctly enlisted JTA/XA resources. External effects need their own design.
   - *"When would you still pick JMS/MQ over Kafka?"* — consider existing mainframe/EJB integration, queue-oriented work distribution, request–reply needs and operational fit; compare ordering and throughput requirements for the actual workload.
4. **Interview framing — the honest version, not the padded one:** lead with the depth you actually have (three MQ vendors, MDB transaction internals, redelivery/ack semantics most candidates have never touched), state Kafka exposure as recent, deliberate, hands-on upskilling with a concrete thing you built, and answer every "have you used X" by mapping it to what you've run in production and naming the real difference. That's a credible senior narrative; claiming fabricated Kafka production history is not, and collapses under one follow-up question.

## 5. Kafka vs. RabbitMQ: the queue-vs-log mental model

Most "Kafka vs. RabbitMQ" debates are really "log vs. queue" debates — once that distinction is clear, the rest of the comparison falls out of it.

**The foundational reframe:** a conventional RabbitMQ queue tracks deliveries and acknowledgments per message; Kafka consumers read an ordered partition log and track positions. Kafka brokers also store committed group offsets and manage retention, replication and group coordination—neither broker is simply “dumb.”

**The analogy:** a queue is a **to-do list**: after successful acknowledgment, the broker can remove that queue's copy. A Kafka log is a **shared journal**: reading or committing an offset does not remove a record; it remains available subject to retention and compaction.

| | Conventional RabbitMQ queue | Kafka topic |
|---|---|---|
| After successful consumption | Acknowledged message is removed from that queue | Record remains until retention/compaction removes it |
| Consumer progress | Broker tracks deliveries and acknowledgments | Consumer position advances locally; committed group offsets are stored by Kafka |
| Replay | An acknowledged queue message is not normally replayable from that queue; archive or republish separately | Reset offsets while the relevant records remain available |
| Independent consumers | Exchange routes copies to separate queues | Consumer groups read the same retained records independently |
| Ordering | Queue delivery order can be affected by competing consumers, redelivery and priorities; processing order needs design | Ordered within a partition, not across partitions; processing concurrency still matters |
| Scaling | Competing consumers share a queue, subject to workload and broker limits | At most one active group member owns a partition at a time; more members than partitions leave some idle |
| Recovery | Acknowledge, reject/requeue and DLQ policies are per message/delivery | Offset-based; retry/seek, pause or DLQ handling determines whether a bad record blocks later work |
| Latency / throughput | Depends on queue type, persistence, size and workload | Depends on partitions, replication, batching and workload; benchmark rather than assume fixed rates |

These are conventional **queues** versus Kafka logs; RabbitMQ also offers **streams**, which have log-like retention and replay semantics. Kafka partition counts can be increased, but doing so can change key-to-partition mapping and affect ordering assumptions.

**Decision heuristic, not a rule:** a task requiring one worker often fits a queue; an event many consumers may independently replay often fits a retained log. Either technology can carry commands or events. A durable queue also decouples producer and consumer in time; Kafka replay is limited to records still retained, not an indefinite historical archive.

**CDC / index-sync scenario:** if a search index must be rebuilt from change events, a retained Kafka topic can support replay by resetting offsets while the needed history remains available. A compacted topic retains the latest value per key eventually, but is not an immutable full history or a substitute for understanding tombstones, retention and a consistent rebuild. Ordering per entity also depends on stable key-to-partition mapping and processing. Compare these guarantees against a queue plus an external archive or database snapshot.

**Poison message trade-off:** blocking a Kafka partition while retrying preserves its order but delays later records. Sending a failed record to a retry/DLQ topic can keep the partition moving, but may change processing order and requires reliable handling of both the failure and the source offset. RabbitMQ's per-delivery `nack` offers another control point, but retry limits and DLQ behavior still need configuration.

## 6. RabbitMQ vs. ActiveMQ vs. IBM MQ — choosing and operating a broker

**Interview scenario:** "Our online banking app sends work to back-end systems. Some consumers are existing EJB applications; another is a new Spring Boot service. How would you choose between IBM MQ, ActiveMQ and RabbitMQ?" Start with the existing integration contracts and team's operational experience, then discuss routing, transactions, failure recovery and availability. All three support asynchronous messaging; none is automatically reliable simply because of its name.

| Dimension | RabbitMQ | ActiveMQ | IBM MQ |
|---|---|---|---|
| Common fit | Polyglot services and flexible message routing | Java/JMS-oriented systems | Enterprise integration, including IBM mainframe estates |
| Application interface | Commonly AMQP clients / Spring AMQP; a JMS client is also available | JMS is a prominent interface; other protocols are available | JMS and IBM MQ-native APIs, among other interfaces |
| Routing model | Exchanges route to queues via bindings | Queues and topics; Classic also offers virtual topics | Queue managers own destinations; channels connect queue managers |
| Deployment and support | Open source; commercial support is also available | Open source; **Classic and Artemis are different brokers** | Commercial IBM product with distributed and z/OS offerings |

These are tendencies, not exclusive capabilities: IBM MQ and ActiveMQ can serve non-Java clients, and RabbitMQ can be used from JMS. Exact features and guarantees depend on the broker, version, client and configuration.

**Follow-up: "We already use MDBs and IBM MQ. Would RabbitMQ be a drop-in replacement?"** Not necessarily. A JMS client for RabbitMQ can expose a familiar API, but check whether the existing transaction manager, selectors, message groups, durable subscriptions, retry/DLQ behavior and provider-specific configuration work as required. With native Spring AMQP, the application and operational model explicitly change to exchanges, bindings and queues. Even ActiveMQ Classic → Artemis is a broker migration with different configuration and operations, not just a version upgrade.

**Follow-up: "How do you know an order event was delivered?"** Separate three milestones: (1) the producer's send or publish result, (2) broker acceptance and routing/storage under the configured durability policy, and (3) the consumer's completed business work and acknowledgment. In RabbitMQ a **publisher confirm** reports broker handling, not that a consumer processed the event; an unroutable publish can still be confirmed, so handle unroutable messages separately (for example with mandatory returns). A consumer can update the database and crash before acknowledging, causing a duplicate delivery. Use an idempotency key or processed-message record; don't equate broker acceptance with end-to-end business success.

**Follow-up: "What happens if processing updates a database and the consumer crashes?"** With an MDB and a properly configured JTA/XA transaction, message consumption and an enlisted database update can commit or roll back together. That requires an XA-capable broker/client, database and transaction manager; a local JMS transaction alone doesn't include an independent database transaction. If distributed transactions aren't appropriate, use a deliberate alternative such as idempotent processing and, for reliably publishing events after a database change, a transactional outbox. Check the actual delivery and failure guarantees rather than assuming any broker makes external side effects exactly once.

**Follow-up: "Our consumer stops, or a broker node fails. Are messages safe?"** These are different failures. For consumer downtime, check destination/subscription existence, message persistence, expiry, retention and acknowledgment behavior. For node failure, also check the actual HA configuration: RabbitMQ quorum queues replicate queue data; ActiveMQ Classic and Artemis have distinct HA options; IBM MQ has platform-specific queue-manager HA, including z/OS queue-sharing groups. A clustered broker alone doesn't prove that a particular destination and message survive a failure. For poison messages, agree on retry limits, dead-letter handling and how operators inspect and replay or resolve them.

**Decision for the banking example:** if the mainframe and established queue-manager/channel infrastructure already use IBM MQ, integration and operational continuity are strong reasons to keep it. A JMS-centric Java estate may favor ActiveMQ; a polyglot estate needing flexible exchange-based routing may favor RabbitMQ. Validate the choice against existing contracts, failure guarantees, team skills and support requirements rather than assuming a universal winner.

References: [RabbitMQ publisher confirms and consumer acknowledgments](https://www.rabbitmq.com/docs/confirms), [ActiveMQ Classic virtual destinations](https://activemq.apache.org/components/classic/documentation/virtual-destinations), [IBM MQ for z/OS concepts](https://www.ibm.com/docs/en/ibm-mq/9.4.x?topic=overview-mq-zos-concepts).
