# Message Middleware: JMS, MDBs and the Kafka Gap

Reviewed: November 19, 2026. Source: personal JMS/MDB notes covering message anatomy, acknowledgment/transaction modes, persistent/durable semantics, request-reply, JMS 2.0 features, message selectors, and ActiveMQ virtual topics vs. composite destinations.

**Context that shapes this file:** 20+ years hands-on with ActiveMQ, RabbitMQ, and IBM MQ — mostly through legacy EJB MDBs — but no production Kafka experience, which is now the de-facto expectation in interviews. This is explainable, not disqualifying: Kafka adoption accelerated well after the EJB/MQ-heavy era most JMS experience comes from. The content below is deliberately organized as a **bridge** — JMS/MQ concept first (where the existing depth already is), Kafka equivalent second, and the real difference that trips people up third. That structure is also the one to use in the interview itself: lead with depth, map it forward, don't fake Kafka production history.

Related: [Spring Boot](Spring-Boot-Interview-Notes.md) (where `@JmsListener`/`@KafkaListener` fit), [REST + MVC](Spring-REST-MVC-Interview-Notes.md#request-reply) (sync alternatives to request-reply messaging).

## 1. JMS fundamentals, kept — these still get asked

**Message anatomy** — this gets asked as "how would you debug a message that silently vanished / got processed twice," not as a trivia recitation: headers (`JMSDestination`, `JMSDeliveryMode`, `JMSMessageID`, `JMSTimestamp`, `JMSCorrelationID`, `JMSReplyTo`, `JMSRedelivered`), properties (app-defined, used by selectors), and body (`TextMessage`, `ObjectMessage`, `BytesMessage`, `MapMessage`, `StreamMessage`). The one header that actually earns its keep in production debugging is `JMSRedelivered` — if it's `true` on a message you're investigating, you immediately know the first attempt failed somewhere downstream (exception, timeout, crash) rather than the message being malformed from the start; that's the first thing to check before digging into business logic.

**Acknowledgment modes** — the detail most Kafka-only candidates have never had to reason about:

| Mode | Behavior | Risk |
|---|---|---|
| `AUTO_ACKNOWLEDGE` | Session acks automatically after `onMessage`/`receive()` returns | Message is lost if the process crashes *after* ack but before your work is durably done |
| `CLIENT_ACKNOWLEDGE` | You call `message.acknowledge()` explicitly, acks *all* messages received so far on that session | Coarse — one missed ack call can re-deliver a whole batch |
| `DUPS_OK_ACKNOWLEDGE` | Lazy, batched acks — broker may redeliver on failure | Explicit at-least-once; your consumer must be idempotent |
| `SESSION_TRANSACTED` | Acks and any other transactional work commit/rollback together | Full atomicity, at the cost of throughput |

**MDB container-managed transactions:** a message-driven bean with `TransactionAttributeType.REQUIRED` runs inside a container-started JTA transaction. An **unchecked exception** propagating out of `onMessage` marks the transaction for rollback — the message is **not deleted**, it goes back to the queue for redelivery (up to a redelivery-limit/DLQ policy). `NOT_SUPPORTED` means no container transaction — you handle your own ack/rollback, and a failure just loses the message unless you've coded recovery yourself. This container-managed "exception = automatic redelivery" behavior is the single biggest mental model Kafka does **not** replicate (see §3).

**Persistent/durable matrix:**

| | Non-persistent | Persistent |
|---|---|---|
| **Queue** | Lost on broker restart, still delivered once to one consumer | Survives restart, still delivered once to one consumer |
| **Topic (non-durable sub)** | Lost if subscriber isn't connected when sent | Still lost if subscriber isn't connected — non-durable means no backlog, period |
| **Topic (durable sub)** | N/A in practice | Broker retains for the subscriber until it reconnects and consumes |

**Request-reply pattern:** requester sets `JMSReplyTo` to a temporary (or well-known) destination and `JMSCorrelationID` to a unique value; the responder reads the request, writes the reply to `JMSReplyTo` with the same `JMSCorrelationID` copied in; requester filters its reply consumer with a selector on that correlation ID. This is genuinely awkward over a queue/topic model — it's solving an RPC problem with a fire-and-forget transport.

**Message selectors:** SQL-92-like filter expressions evaluated against message *properties* (never the body) at the broker, so non-matching messages are never delivered to that consumer. Cost: the broker evaluates the selector per message per subscriber — cheap for a few consumers, a real scaling concern with many selector-based consumers on one busy destination (broker CPU scales with consumer count × selector complexity).

**JMS 2.0 additions worth naming:** delivery delay (`setDeliveryDelay`), shared (non-durable and durable) subscriptions so multiple consumers can load-balance a topic subscription, simplified API (`JMSContext`), async send, and `JMSXDeliveryCount` property to inspect redelivery attempts without rolling your own counter.

**Anti-patterns (still correct under Kafka, by the way):**
- **Single-purpose queue/topic** — don't multiplex unrelated message types onto one destination and rely on consumers to filter; it couples unrelated schemas and makes selective scaling impossible.
- **Priority overuse** — JMS priority levels are a broker-side scheduling hint, not a strict guarantee, and heavy reliance on them usually masks a capacity problem. (Kafka doesn't even offer this knob — see §3.)
- **Header misuse** — properties/headers are for routing and filtering metadata, not a place to smuggle business payload that belongs in the body.

## 2. ActiveMQ virtual topics vs. composite destinations

This is the kind of detail a vendor-agnostic Kafka-only candidate can't answer, so it's worth having ready as a "here's something specific I've actually operated" moment — the scenario that surfaces it in an interview is "a new consumer team needs a copy of every order event, how do you add them without touching the producer or redeploying anything":

- **Virtual topic:** producer sends once to a topic; ActiveMQ fans it out to per-consumer backing queues (`Consumer.A.VirtualTopic.Foo`, `Consumer.B.VirtualTopic.Foo`, ...) automatically as consumers subscribe — dynamic, broker-managed fan-out, each consumer gets queue semantics (durable, competing-consumer-safe) without a durable topic subscription. Answer to the scenario above: the new team just starts a consumer on `Consumer.NewTeam.VirtualTopic.Orders` — zero producer-side change.
- **Composite destination:** producer is configured to send to a *static*, pre-declared list of destinations in one send call — fan-out is fixed at config time, not driven by who's currently subscribed. Same scenario here means editing the producer's destination config and redeploying it — the trade-off an interviewer is really probing for.

The practical difference: virtual topics scale with consumers joining/leaving at runtime; composite destinations are simpler to reason about but require a config change (and often a redeploy) to add a new fan-out target.

## 3. The JMS -> Kafka bridge — concept by concept

| You know (JMS/MQ) | Kafka equivalent | The difference that actually bites |
|---|---|---|
| Queue (point-to-point, one consumer gets each message) | One consumer group on a topic | Kafka achieves "only one gets it" via consumer-group partition assignment, not broker-side delivery tracking — the message itself isn't removed from the log |
| Topic (pub-sub, every subscriber gets every message) | Multiple consumer groups reading the same topic | Each group independently tracks its own offset; the log is the same, "pub-sub" is just "more than one group reading it" |
| Durable topic subscription | Consumer group with committed offsets + retention window | Kafka retains by time/size regardless of consumption — there's no "has anyone consumed this yet" bookkeeping at the broker |
| `AUTO_ACKNOWLEDGE` | `enable.auto.commit=true` | Same risk shape: commit can happen before your processing is durably finished -> silent loss on crash |
| `CLIENT_ACKNOWLEDGE` | Manual synchronous `commitSync()` after processing | Commit the offset only after your side-effect is durable — same discipline, different API |
| `SESSION_TRANSACTED` | Kafka transactions (idempotent producer + `transactional.id` + `read_committed` consumers) | Conceptually similar atomicity goal, very different mechanics (producer epoch fencing, not a 2PC-style JTA transaction) |
| MDB auto-redelivery on unchecked exception | **Nothing automatic** — you must not commit the offset, then re-process or route to a retry/DLQ topic yourself | This is the biggest trap: assuming Kafka "just redelivers like my MDB did" — it does, but only because you didn't advance the offset, and only up to however many `poll()` cycles you choose to retry before giving up |
| Message selector (broker-side filter) | No broker-side filter | Filter client-side after consuming, or design topic/partition-key layout so routing happens through the key instead of a filter expression |
| Persistent message, delivered once | The log itself, replayable by any consumer that resets its offset | Kafka's default mental model is "replay any time," which is the opposite of "delete on ack" |
| JMSReplyTo/CorrelationID request-reply | A reply-topic + correlation-id header, built by hand | Kafka isn't built for RPC; if you truly need request-reply, a REST/gRPC call is usually the right tool, not Kafka |
| Virtual topic (dynamic fan-out to per-consumer queues) | Multiple consumer groups on one topic | Same intent (let N independent consumers each see everything), Kafka does it natively without extra broker config |
| Message priority | **Not supported** | Ordering is partition-only in Kafka; if priority matters, route high-priority messages to a separate topic/partition instead |

## 4. Closing the gap — a concrete plan

1. **Hands-on, this weekend, using an app you already have:** `docker-compose` up a single-broker Kafka (KRaft mode, no Zookeeper needed), add Spring Kafka to one of your existing Spring Boot apps, and build: a producer, a consumer with manual ack (`AckMode.MANUAL`), an idempotent-producer config, and a retry-topic + DLQ pattern for a message that throws. Then run two consumer instances in the same group against a multi-partition topic and watch partition rebalancing happen live — that single exercise answers three common interview questions at once.
2. **Lock in the vocabulary you don't have yet:** broker, partition, offset, consumer group, replication factor, ISR (in-sync replicas), leader/follower, producer `acks` levels (`0`/`1`/`all`), idempotent producer, transactions, Kafka Streams/Connect (awareness-level), Schema Registry + Avro (backward/forward compatibility) if your target role does event-driven integration.
3. **Rehearse the handful of questions that actually get asked:**
   - *"Why does partition key design matter?"* — ordering is guaranteed only within a partition; a bad key choice creates a hot partition and starves parallelism.
   - *"How do you handle a poison message?"* — in MDB it rolled back to the queue automatically; in Kafka you detect the failure, skip or route to a DLQ topic, and advance the offset yourself — otherwise you've created an infinite redelivery loop that blocks the partition.
   - *"How do you get exactly-once in Kafka vs. a transacted JMS session?"* — idempotent producer + `transactional.id` + `read_committed` consumers, versus a single JTA-managed session; same goal, structurally different mechanism.
   - *"When would you still pick JMS/MQ over Kafka?"* — strict ordering with request-reply semantics, lower-throughput enterprise integration, mainframe/EJB-era system boundaries. This is the one question where your 20+ years gives you a *better* answer than a Kafka-only candidate.
4. **Interview framing — the honest version, not the padded one:** lead with the depth you actually have (three MQ vendors, MDB transaction internals, redelivery/ack semantics most candidates have never touched), state Kafka exposure as recent, deliberate, hands-on upskilling with a concrete thing you built, and answer every "have you used X" by mapping it to what you've run in production and naming the real difference. That's a credible senior narrative; claiming fabricated Kafka production history is not, and collapses under one follow-up question.

## 5. Kafka vs. RabbitMQ: the queue-vs-log mental model

Most "Kafka vs. RabbitMQ" debates are really "log vs. queue" debates — once that distinction is clear, the rest of the comparison falls out of it.

**The foundational reframe:** RabbitMQ is a smart broker with dumb consumers — it tracks per-message state (who got it, was it acked, should it be redelivered, which queue does it route to). Kafka is a dumb broker with smart consumers — it just appends to a file and tells each consumer "you're at byte offset N"; consumers own their own position.

**The physical analogy:** a **queue** (RabbitMQ/SQS) is a **to-do list** — take an item, do it, cross it off, it's gone; consumption *destroys* the work. A **log** (Kafka) is a **newspaper archive** or ledger — everyone reads the same pages, your bookmark is yours alone, reading changes nothing; consumption *observes* the work without consuming it. That single difference generates every other difference below.

| | Queue (RabbitMQ) | Log (Kafka) |
|---|---|---|
| Message after read | Deleted | Retained |
| Consumer position | Broker-tracked | Consumer-tracked (offset) |
| Replay | Not supported | Core feature — reset offset, reprocess from any point |
| Multiple independent consumers | Fan-out via exchanges; broker tracks state per queue | Native — each consumer group reads independently, no coordination |
| Ordering | Per-queue, lost once you parallelize consumers | Guaranteed per partition only |
| Parallelism unit | Consumers (add freely) | Partitions (fixed at topic creation — must be planned ahead) |
| Routing | Rich (topic, header, direct, fanout exchanges) | Just topic + partition key |
| Per-message ack/retry | Precise, selective | Offset-based; one poison message blocks the rest of its partition |
| Delayed/priority messages | Supported (plugin / native) | Not supported — route priority traffic to a separate topic instead |
| Throughput | High (tens of thousands/sec) | Extreme (millions/sec) |
| Operational weight | Moderate | Heavier (though KRaft removed the ZooKeeper dependency) |

**Verb test — the single heuristic that resolves most real decisions:** *"Do this task"* is a command → queue (one owner, success means it's done and gone — send an email, resize an image, charge a card). *"This happened"* is a fact → log (many interested parties, now and in the future — `OrderPlaced`, `PriceChanged`; the producer doesn't know or care who's listening). **Commands → queue. Events → log.**

**The temporal reframe:** a queue couples producer and consumer in time — a message must be consumed to have value. A log decouples them in time — a consumer that doesn't exist yet can still receive everything a producer emitted years earlier. Kafka is time-travel for data; a queue is a conveyor belt.

**For CDC/index-sync specifically**, Kafka wins over a plain queue on four concrete properties: ordering per key (partitioning by entity ID keeps every update to the same row in order — RabbitMQ with multiple competing consumers gives no such guarantee), replay (rebuilding a search index or derived store is a routine operation; Kafka resets an offset, a queue needs a separate full-scan rebuild job), native multi-consumer fan-out without per-consumer broker config, and log compaction (a compacted, keyed topic is effectively a replayable snapshot of current state — the exact shape an index-sync feed needs). This is also why Kafka is the default, best-supported sink for **Debezium CDC**.

**Where the models break down — know the failure modes:**
- Kafka's partition count is a hard ceiling on consumer parallelism; repartitioning later is painful.
- Kafka head-of-line blocking — one bad message in a partition stalls everything behind it; needs an explicit DLQ, unlike RabbitMQ's per-message `nack`.
- Kafka is not a task queue — forcing "run 10k jobs" workloads onto it fights the model constantly.
- RabbitMQ queues should stay shallow; it's designed for messages in flight, not for storage.

**Final compression:** a queue distributes work; a log distributes truth. Ask which one you're actually moving.
