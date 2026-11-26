# Cloud Fundamentals, Containers and CI/CD Notes

Reviewed: November 19, 2026. Source: the seven-page Cloud Fundamentals PDF (hypervisors, VMs, containers, Docker internals, Kubernetes/AKS/EKS/GKE/OpenShift/PCF, PaaS comparisons), plus a prior session on AKS scaling/Helm/control-plane mechanics, folded in to cover the CI/CD + containerization gap this prep identified earlier. Observability (OpenTelemetry/Azure Monitor/App Insights) and Bicep/IaC sections were added later to close two further resume gaps the user chose to fold in here rather than spin out into separate files.

**Context that shapes this file:** hands-on experience is strong on the application side (Spring Boot services deployed *onto* AKS/Kubernetes) but thin on owning the pipeline and cluster plumbing itself — build/push/deploy automation, Helm internals, autoscaling knobs. That's a normal division of labor (app teams vs. platform/DevOps teams), not a disqualifying gap — but it means this file leans deliberately toward the parts an app developer is expected to reason about in an interview (why a container, what a pipeline stage catches, how scaling decisions get made) rather than infra-team depth (cluster bring-up, networking, etcd internals).

Related: [Spring Boot](../spring/Spring-Boot-Notes.md#7-boot-vs-cloud) (Spring Boot app packaged as the container these notes deploy), [Message Middleware](Message-Middleware-Notes.md) (queue/broker workloads that often run as KEDA-scaled K8s workers).

## 1. Virtualization: hypervisors and VMs

| Type | Runs on | Example | Trade-off |
|---|---|---|---|
| **Type 1 (bare-metal)** | Directly on hardware | VMware ESXi, Hyper-V, Xen | Lower overhead, used in data centers/cloud |
| **Type 2 (hosted)** | On top of a host OS | VirtualBox, VMware Workstation | Simpler for a laptop/dev box, more overhead |

A **VM** virtualizes hardware: each VM has its own full OS kernel, so isolation is strong but every VM pays the cost of booting and running a complete OS (minutes to start, GBs of disk/RAM overhead). Good for: running different OS kernels side by side, strong workload isolation, legacy apps that assume a dedicated machine.

**Why keep a VM when containers exist?** A legacy application may require a particular OS, native library or proprietary application server; a VM gives control over that environment. A test VM can be restored to a known snapshot after a destructive experiment. Snapshots are useful for rollback, but are not a substitute for independent backups or a tested recovery plan.

**Multi-cloud vs. hybrid cloud** — a distinction interviewers like to probe because people conflate them:
- **Hybrid cloud** — one workload spans on-prem + cloud (or two clouds) as *one coordinated system*, usually for data residency, latency, or gradual migration (e.g., keep the DB on-prem, burst compute to Azure).
- **Multi-cloud** — using more than one cloud provider for *different, independent* workloads or for redundancy/negotiating leverage — not necessarily integrated.

## 2. Containers vs. VMs — the mechanism, not just the diagram

A **container** doesn't virtualize hardware — it shares the host's kernel and uses OS-level isolation primitives:

| Primitive | What it isolates |
|---|---|
| **Namespaces** (`PID`, `NET`, `MNT`, `UTS`, `IPC`, `USER`) | What a process can *see* — its own process tree, network stack, filesystem mounts, hostname, IPC objects, and user/group ID mapping |
| **cgroups** (control groups) | What a process can *use* — CPU, memory, I/O, and process-count limits/accounting |
| **Union filesystem** (OverlayFS) | Layers multiple read-only image layers plus one writable layer into a single merged view |

Because there's no second kernel to boot, containers start in milliseconds/seconds and have near-zero overhead per instance — the trade-off is weaker isolation than a VM (a kernel-level exploit can cross container boundaries; a hypervisor escape is a much rarer class of bug). This is *why* production clusters often run containers **inside** VMs (an AKS node is a VM; pods are containers on it) — VM-level isolation at the node boundary, container-level density inside it.

**OverlayFS copy-on-write, in one sentence:** a container's writable layer only ever contains the files it has changed; reads fall through to the read-only image layers underneath, so ten containers from the same image share the same underlying layers on disk and only pay storage for their own diffs.

**Interview framing that lands better than "containers are lightweight VMs":** a container is a normal Linux process with restricted visibility and bounded resources, not a separate virtual machine — that's the reason for the startup-time and density difference, and it's also why "what happens on kernel panic" differs (one shared kernel crash takes down every container on that host, unlike VMs on a hypervisor).

## 3. Docker fundamentals

These terms rarely get asked as flashcard definitions — they show up as the vocabulary an interviewer expects you to use precisely while answering a "why did this build/deploy behave oddly" question, which is why the practical content right after this table matters more than the table itself:

| Component | Role |
|---|---|
| **Docker Daemon** (`dockerd`) | Background service that builds, runs, and manages images/containers/networks/volumes |
| **Docker Client** (`docker` CLI) | Talks to the daemon over a REST API (local socket or remote) |
| **Docker Engine** | The daemon + API + CLI together |
| **Image** | Immutable, layered filesystem + metadata (entrypoint, env, exposed ports) — the build artifact |
| **Container** | A running (or stopped) instance of an image, with its own writable layer |
| **Dockerfile** | Declarative build recipe — each instruction (`FROM`, `COPY`, `RUN`, `ENTRYPOINT`) creates a new image layer |
| **Volume** | Storage that lives outside the container's writable layer, so data survives container removal/recreation |

**Why layers matter beyond build speed:** Docker caches each Dockerfile instruction's layer; changing a line invalidates that layer *and every layer after it*. The classic interview-relevant mistake is `COPY . .` before `RUN npm install`/`mvn dependency:go-offline` — any source change busts the dependency-install layer too, so every build re-downloads the world. Fix: copy only the dependency manifest first, install, *then* copy the rest of the source.

```dockerfile
# Bad: any source change invalidates the dependency layer
COPY . .
RUN mvn dependency:go-offline

# Better: dependency layer only invalidates when the manifest changes
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package
```

**Volumes vs. bind mounts vs. the container's own layer:**
- **Container writable layer** — fast, but gone the moment the container is removed (`docker rm`). Fine for scratch/temp data only.
- **Named volume** — Docker-managed storage, outlives the container, portable across container recreation — the right default for a DB's data directory.
- **Bind mount** — maps a specific host path in; mainly a local-dev convenience (live-reload source code into a running container), not something you'd rely on in a cluster where the host filesystem isn't guaranteed to be the same machine next time.

**Vagrant's role (why it still comes up):** Vagrant manages *VM* lifecycles (spin up/tear down a reproducible VM from a box image, often backed by VirtualBox) — it solves "give every developer an identical full-OS sandbox," a different problem from Docker's "package and run app processes with OS-level isolation." Teams that adopted containers largely replaced Vagrant for that use case, but Vagrant is still relevant when you genuinely need a different *kernel*/OS, not just an isolated process.

## 4. CI/CD for a containerized app — the pipeline an interviewer expects you to reason about

A typical pipeline for a Spring Boot (or any) service targeting AKS looks like:

```
commit/PR → build & unit test → build container image → push to registry
         → deploy to non-prod (Helm/manifests) → integration/smoke tests
         → promote to prod (often with approval gate) → post-deploy verification
```

| Stage | What it actually catches | Typical tool |
|---|---|---|
| **Build + unit test** | Compile errors, broken unit-level logic, before anything is packaged | Maven/Gradle + JUnit, GitHub Actions/Azure Pipelines |
| **Static analysis / linting** | Code-quality and known-vulnerability patterns before merge | SonarQube, dependency-check |
| **Image build** | Packages the tested artifact into a container image, tagged (commit SHA or semver, **not** `latest`) | `docker build`, Buildpacks |
| **Image scan** | CVEs in the base image/dependencies — catches what unit tests can't | Trivy, Azure Defender for Containers |
| **Push to registry** | Makes the exact tested artifact available to every environment | Azure Container Registry, ECR, Docker Hub |
| **Deploy (non-prod)** | Runs `helm upgrade`/applies manifests against a real cluster namespace | Helm, Argo CD/Flux (GitOps), raw `kubectl` |
| **Integration/smoke tests** | Does the deployed service actually come up and answer health checks — catches config/env issues unit tests never see | Post-deploy test job, synthetic probes |
| **Promotion to prod** | Same already-tested image/tag moves forward — never a prod-only rebuild | Approval gate, progressive rollout |

**The single idea that ties this together, and the one worth leading with in an interview:** *build the artifact once, promote the same artifact through every environment.* Rebuilding per environment reintroduces "works in staging, breaks in prod" because you're no longer testing what you'll actually ship — a different base-image patch version, a different dependency resolution, could sneak in between builds.

**Deployment strategies — a question that always follows "how do you deploy":**

| Strategy | Mechanism | Trade-off |
|---|---|---|
| **Rolling update** | K8s Deployment default — replaces old pods with new ones gradually | Simple, built-in, but a bad new version is serving traffic to *some* users during rollout |
| **Blue/green** | Two full environments; switch traffic (often at the ingress/load-balancer) all at once | Instant rollback (flip back), but needs double the infra during the switch |
| **Canary** | New version gets a small traffic slice (5–10%), monitored, then ramped | Limits blast radius of a bad release, but needs good metrics/alerting to actually catch the canary failing |

**GitOps (Argo CD/Flux) vs. a push-based pipeline:** a traditional pipeline *pushes* `helm upgrade` from CI into the cluster; GitOps instead has a controller *inside* the cluster continuously reconciling against a Git repo's declared state — the pipeline's job becomes "update the Git repo," and the in-cluster controller does the actual apply. Benefit: the cluster's desired state is always auditable from Git history, and drift (someone ran `kubectl edit` by hand) gets silently reverted on the next reconcile instead of lingering unnoticed.

**A scenario worth having ready:** *"Deployment succeeded in the pipeline but the new pods are crash-looping — what do you check?"* Pipeline "success" usually only means the image built/pushed and `kubectl apply`/`helm upgrade` was accepted by the API server — it does **not** mean the pods became healthy. Check (in order): `kubectl describe pod` for the failure reason (`CrashLoopBackOff`, `ImagePullBackOff`, `OOMKilled`), then pod logs for the actual exception, then whether a config/secret the app expects (env var, ConfigMap, connection string) exists in *this* environment/namespace — a very common real cause is an environment-specific config value missing or stale after promotion.

## 5. Kubernetes/AKS ecosystem

**AKS = managed control plane.** Microsoft/Azure runs the API server, scheduler, controller-manager, and `etcd`; you manage node pools, workloads, and configuration. This is why most app-team engineers never touch the control plane directly — Helm/`kubectl` talk *to* the control plane, they don't replace it.

**Node ≈ VM.** An AKS node is normally an Azure VM (via a VM Scale Set) that joined the cluster; a node can run pods from many different applications (no default one-app-per-node boundary) unless you deliberately isolate with taints/tolerations + node selectors + a dedicated node pool. A node belongs to exactly one cluster — clusters never share worker nodes, even in the same subscription/VNet.

**Two separate scaling layers — the distinction interviewers probe for:**

| Layer | What it changes | Mechanism |
|---|---|---|
| Application | Pod replica count | **HPA** (CPU/memory/custom metric), **KEDA** (event-driven: queue depth, Kafka lag, cron — including scale-to-zero) |
| Resource sizing per pod | CPU/memory *requests* on existing pods | **VPA** (often run in recommendation-only mode first) |
| Infrastructure | Node count | **Cluster Autoscaler** (adds nodes when pods are unschedulable, removes underutilized ones), **Node Auto Provisioning** (also picks node *type*) |

A reasonable baseline to state in an interview: HPA for synchronous API pods, KEDA for async queue/event workers, Cluster Autoscaler/NAP for nodes, VPA in recommendation mode for right-sizing — and never leave a fixed `replicaCount` actively reconciled by Helm on a Deployment that HPA also controls (they'll fight each other).

**Helm's actual job:** renders chart templates into plain Kubernetes YAML and submits it to the API server — it is a packaging/templating tool, not a second control plane. It does not create the AKS cluster itself (that's Bicep/Terraform/ARM/`az aks create`); it deploys *into* an already-provisioned cluster.

### Incoming HTTPS: gateway, ingress and pods

**Example 1 — Application Gateway with AGIC:**

```text
Request path:
Client ── HTTPS /orders ──> Application Gateway + WAF ──> ready order pod
                            L7 routing / balancing         in AKS

Configuration path:
Helm ──> Kubernetes Ingress ──> Order Service
                  │                   │ selects order pods
                  └──> AGIC watches configuration and endpoints
                            └──> programs Application Gateway
```

Application Gateway is the **data plane**: it handles HTTP traffic, applies configured WAF rules and chooses a healthy backend. **AGIC (Application Gateway Ingress Controller)** is the **controller**: it translates Kubernetes configuration into gateway settings; requests do **not** pass through AGIC. With AGIC, the gateway can route directly to pod IPs, not necessarily through the Service virtual IP. An Ingress describes host/path rules and references a Service; a Service identifies pods and can also provide a stable cluster address and distribute connections when traffic uses it. Gateway health probes and Kubernetes readiness must both be configured correctly.

The gateway is a separate Azure resource, usually provisioned through Bicep or Terraform. Helm typically deploys the app's Service and Ingress; AGIC may be installed with Helm or as an AKS add-on. The chart does not need to create the gateway itself. A WAF in **Detection** mode logs matches; **Prevention** mode can block them. Check the actual environment rather than assuming either mode.

**Example 2 — a proxy ingress controller running in AKS:**

```text
Client ──> Azure Load Balancer ──> ingress proxy replicas ──> Order Service ──> order pod
                 L4                   L7 HTTP routing            cluster routing
```

This is an alternative topology, not a mandatory extra hop in example 1. Azure Load Balancer distributes TCP/UDP connections to proxy replicas; the proxy routes by host or path. The Service's networking layer can distribute connections to ready pods; depending on the controller, the proxy may instead route directly to pod endpoints. Balancing across proxy replicas and across app pods are **different jobs**, not necessarily two separate Azure Load Balancer resources.

| Component | Primary role / decision |
|---|---|
| **Azure Load Balancer** | Layer 4: distributes TCP/UDP connections; doesn't route based on HTTP paths. |
| **Application Gateway** | Layer 7: HTTP routing and balancing, TLS termination and optional WAF. Azure operates the gateway; the team still owns its configuration. |
| **API gateway / Azure API Management (APIM)** | Separate from Application Gateway. Applies API policies such as token validation, per-client limits and API versions; APIM can also provide subscriptions and a developer portal. |
| **In-cluster ingress proxy** | HTTP routing inside AKS. Choose for its specific capabilities or portability, accounting for proxy scaling, upgrades and operations; WAF and API policies may be provided elsewhere. |

These roles can overlap. APIM is optional: for example, `Client → Application Gateway + WAF → APIM → AKS backend` puts WAF inspection before APIM; ensure clients cannot bypass the intended enforcement layer. The backend may use an ingress proxy or another supported route, depending on network design. A gateway or proxy's replicas also need load distribution, but a managed gateway may handle this internally.

**Interview follow-ups:** A Kubernetes Service usually balances at L4, not by HTTP path; an ingress or gateway provides L7 routing. A rate limiter is often a configured gateway policy, not custom application code, but check whether limits are per replica or shared and whether the product exposes an algorithm choice. APIM and WAF are not automatically provided by AKS. Choose managed Application Gateway + AGIC for Azure-integrated routing/WAF, or an in-cluster proxy when its features and operational trade-offs fit; neither is mandatory for every application.

**Troubleshooting:** If the Ingress exists but traffic fails, check AGIC reconciliation and permissions, gateway listener/rule and backend health probes, then Service selectors, pod readiness and network reachability. If the gateway has no healthy backends, adding more application replicas alone will not fix a wrong probe path or port.

**Managed Kubernetes/PaaS comparison:**

| Platform | What it manages for you | Positioning |
|---|---|---|
| **AKS** (Azure) | Control plane, Azure-native integration (AAD, Monitor, networking) | Standard K8s + Azure ecosystem glue |
| **EKS** (AWS) | Control plane, AWS-native integration (IAM, VPC, CloudWatch) | Same idea, AWS ecosystem |
| **GKE** (Google) | Control plane, often cited as the most "batteries-included" (Autopilot mode) | Same idea, GCP ecosystem |
| **OpenShift** (Red Hat) | Control plane + opinionated add-ons (built-in CI/CD, routes, stricter security defaults) | Enterprise/on-prem-friendly K8s distribution |
| **Pivotal/VMware Cloud Foundry (PCF)** | Entire deployment model — `cf push` an app, platform figures out containers/routing | Higher-level PaaS, less K8s-aware by design |

**AKS vs. Azure Spring Apps:** AKS is general-purpose container orchestration — you own the Dockerfile, Helm chart, and scaling config, for any workload. Azure Spring Apps is a narrower, opinionated PaaS specifically for Spring Boot/Spring Cloud apps — push the jar, the platform handles the container, service discovery, and config server wiring for you, at the cost of control (you can't arbitrarily run non-Spring workloads or hand-tune the underlying pod spec).

**Platform decision in practice:** VMs offer OS-level control but leave patching, runtime and deployment more directly to the team. App Service manages a web-app hosting platform; Azure Container Apps manages container execution and event-driven scaling without requiring teams to operate Kubernetes directly; AKS provides Kubernetes controls with additional cluster, networking and operations ownership. Functions fits supported event-driven workloads with an execution model and hosting-plan constraints to examine. Choose based on runtime, networking, state, scaling and operational ownership—not a blanket “serverless is best.” Keep durable state outside replaceable instances.

**Java workload selection — what would the team actually own?**

| Workload / constraint | Candidate | What remains your responsibility |
|---|---|---|
| Spring Boot web API packaged as a JAR; team wants minimal platform administration | **App Service** using a supported managed Java runtime | Application, dependencies, configuration and secrets; check supported runtime/server versions, networking and patch policy. A custom container shifts image and JVM patching back to you. |
| Existing Java monolith packaged as an image, or HTTP service plus event-driven workers | **Container Apps** | Build, scan and update the image and JVM; choose scaling rules, resource limits and state storage. The platform manages container hosting, not application correctness. |
| Small event-triggered Java handler | **Functions** | Adapt to triggers, retries and the chosen hosting plan's execution limits; externalize durable state. Cold starts and instance-local caches/session state matter when instances scale or restart. |
| Mixed services requiring Kubernetes APIs, custom scheduling or ecosystem tooling | **AKS** | Image/JVM updates, workloads, node pools, networking, upgrades and cluster policies under the applicable AKS responsibility model. Greater control has an operations cost. |
| Proprietary application server, specific OS or native dependency unsupported by the managed options | **VM** | OS/JVM/server patching, security hardening, monitoring, capacity and recovery. First verify whether a supported managed runtime or container can meet the requirement; native code alone does not require a VM. |
| Existing Spring Apps deployment | **Migration assessment** | Check dependencies on its managed Spring features and plan the migration before retirement; do not assume Container Apps or AKS is a drop-in replacement. |

**Artifact follow-up:** source deployment builds on the platform; deploying a CI-built JAR/WAR or container image lets the team test and promote that exact artifact. EAR/WAR support depends on the selected runtime and server, not just the word “Java.” Managed runtimes can reduce OS/JVM maintenance, but the team still owns dependencies, secrets, access, data and application-level security; verify the service's actual shared-responsibility model.

**Lifecycle caveat:** Azure Spring Apps Basic, Standard and Enterprise retire on **March 31, 2028**. For new designs and migration planning, assess Azure Container Apps or AKS against the workload instead of treating Spring Apps as a long-term default. [Microsoft retirement announcement](https://learn.microsoft.com/en-us/azure/spring-apps/basic-standard/retirement-announcement).

**OpenShift vs. Cloud Foundry:** OpenShift is Kubernetes with Red Hat's opinionated layer on top (you still think in pods/deployments, just with more guardrails and built-in tooling). Cloud Foundry/PCF abstracts away Kubernetes concepts almost entirely — you `cf push` a buildpack-detected app and never write a Deployment/Service yourself. The trade-off is the same shape as PaaS-vs-IaaS generally: CF is faster to a working deployment for a supported app shape, OpenShift/K8s gives more control when the workload doesn't fit CF's opinions.

## 6. Observability: OpenTelemetry, Azure Monitor, Application Insights

**The layer this sits at:** the pipeline/cluster sections above get a service *deployed and scaling*; observability is how you know it's actually *healthy* once it's there — and it's the resume-named tooling (Azure Monitor/App Insights/OpenTelemetry) most likely used behind a Spring Boot Actuator/auto-instrumentation layer rather than hand-wired, which is worth saying plainly before going into the mechanics.

**The three pillars, and what each is actually good for:**

| Pillar | Answers | Example |
|---|---|---|
| **Metrics** | "Is it healthy right now, in aggregate?" — numeric, cheap to store/alert on | Request rate, error rate, p95/p99 latency, JVM heap/GC pause time |
| **Logs** | "What exactly happened for this one event?" — unstructured or structured detail | Exception stack trace, a specific request's processing steps |
| **Traces** | "Where did the time go, across services, for this one request?" — causal chain | A request spanning Gateway → Service A → Service B → DB, each hop as a span |

**Spring Boot logs on AKS → Log Analytics:** a normal SLF4J/Logback application can write to the console without Azure-specific logging code. The usual collection path is `Spring Boot → stdout/stderr → container runtime log files on the node → Azure Monitor agent → Log Analytics workspace`, commonly into the `ContainerLogV2` table. The platform team must enable **Container Insights**, connect a workspace, and configure data collection to include the container logs; deploying to AKS alone doesn't enable this pipeline.

On the application side, verify logs actually reach stdout/stderr: a Logback configuration that writes *only* to a file inside the container won't be collected by this standard console-log path. JSON formatting and trace IDs make investigation easier but are not required for basic collection; avoid logging secrets or sensitive data. Stack traces may need multiline collection configuration to appear as one entry.

**Practical investigation:** if order-service logs are missing from Log Analytics, first check `kubectl logs` for the pod, then check Container Insights, workspace and collection filters. If using `ContainerLogV2`, search the workspace with the actual namespace and container name:

```kusto
ContainerLogV2
| where TimeGenerated > ago(1h)
| where PodNamespace == "banking" and ContainerName == "order-service"
| project TimeGenerated, PodName, LogLevel, LogMessage
| order by TimeGenerated desc
```

The trap in an interview is treating these as interchangeable: a metric tells you *that* p99 latency spiked at 14:32; it can't tell you *why* — that needs a trace (which service/span in the chain actually slowed down) and then a log (the specific error/condition inside that span).

**OpenTelemetry (OTel) — why it exists:** before OTel, each vendor (Application Insights SDK, Jaeger client, Zipkin client, Datadog agent) had its own instrumentation API, so switching observability backends meant re-instrumenting the whole codebase. OTel is a **vendor-neutral instrumentation standard** — a common API/SDK for emitting metrics/logs/traces, plus the **OTel Collector**, a separate process that receives telemetry and exports it to *any* backend (Azure Monitor, Jaeger, Prometheus, Datadog) via configuration, not code changes. The practical payoff: instrument once, change your mind about the backend later without touching application code.

**Where auto-instrumentation fits (the likely real-world shape of the experience):** Spring Boot + Micrometer (metrics facade) + Micrometer Tracing (bridges to OTel) + the Azure Monitor OpenTelemetry Distro/Java agent can auto-instrument HTTP calls, JDBC calls, and messaging calls with **zero application code changes** — attach a Java agent at startup, and spans/metrics for every inbound/outbound call appear automatically. This is almost certainly the "I've used App Insights/Azure Monitor" reality for most Spring Boot teams: the abstraction (agent + Actuator) does the instrumentation; the application code stays untouched unless a custom span/metric is needed for business-specific logic.

**Trace context propagation — the mechanic that makes distributed tracing possible:** a single logical request gets one **trace ID**; each hop (service call) creates a child **span** with its own span ID and a reference to its parent span, and that context (trace ID + parent span ID) is carried across process boundaries in HTTP headers (the `traceparent` W3C Trace Context header is OTel's standard). Without propagating that header through every outbound call (including into a message broker's headers for async hops), the trace breaks into disconnected fragments per service instead of one coherent end-to-end view — a very common real bug when a service manually constructs an HTTP client without the auto-instrumented `RestTemplate`/`WebClient`/`HttpClient` bean.

**Correlation ID vs. trace ID — a distinction worth having precise:** a trace ID is OTel/tracing-system-specific and spans the full multi-service call tree; a correlation ID is often a simpler, application-defined header (e.g., `X-Correlation-Id`) threaded through logs so a human can `grep` one customer-visible request across log files even without a full tracing backend. Many systems carry both — correlation ID for human log-searching, trace ID for the tracing backend's span graph — and they can even be the same value if deliberately wired that way.

**The interview scenario to have ready:** *"p99 latency on an endpoint spiked for 10 minutes last night — walk me through how you'd find the cause."* Start at metrics/dashboards to confirm scope (one endpoint? one region? correlated with a deploy or a downstream outage?), then pull a trace for a slow request in that window to see which span/hop actually absorbed the time (app code vs. DB vs. a downstream call), then pull logs scoped to that trace ID/time window for the specific exception or slow-query detail — metrics narrow *when/where in aggregate*, tracing narrows *which hop*, logs give the *specific reason*.

## 7. Infrastructure as Code: Bicep

**What problem IaC solves, before the tool specifics:** without IaC, "what does our infrastructure actually look like" lives in whoever clicked through the Azure Portal last, with no history, no review, and no repeatable way to stand up a second environment identically. IaC makes infrastructure a versioned, reviewable artifact (a file in the same repo/PR workflow as application code), and the deployment tool reconciles the *declared* state against *actual* Azure resources rather than you running imperative scripts.

**Bicep vs. ARM templates vs. Terraform — the question that actually gets asked:**

| Tool | Format | Scope | Positioning |
|---|---|---|---|
| **ARM templates** | Raw JSON | Azure only | Verbose, hard to hand-author; Bicep compiles down to this |
| **Bicep** | Declarative DSL (not JSON) | Azure only | Azure-native, first-party Microsoft tooling, simpler syntax than ARM, no state file to manage (Azure itself is the source of truth) |
| **Terraform** | HCL | Multi-cloud (Azure, AWS, GCP, etc.) | The standard choice when infra spans multiple clouds or the team wants one tool everywhere; needs an externally-managed state file |

The practical trade-off to state plainly: Bicep is the better fit for an Azure-only shop wanting the least friction with first-party tooling (`az deployment group create`, deep Azure Resource Manager integration, automatic "what-if" diff preview); Terraform wins once more than one cloud is in play, or an org already has Terraform expertise/tooling (CI modules, state backends) it doesn't want to duplicate for one more DSL.

**Idempotency and "what-if" — the core IaC guarantee to be able to explain:** re-running the same Bicep deployment against infrastructure that already matches the template is a no-op (ARM computes a diff and only changes what actually differs) — this is what makes it safe to run deployments repeatedly/in CI rather than only once by hand. `az deployment group create --what-if` previews exactly that diff (create/modify/delete per resource) *before* applying it — the IaC equivalent of a dry-run, and the answer to "how do you avoid an unreviewed destructive change sneaking into a pipeline."

**Modules and parameters — how a real Bicep setup avoids copy-pasted templates per environment:** a `module` block lets one Bicep file reference another (e.g., a reusable "App Service + App Insights" module), and `@description()`-documented `param`s (environment name, SKU size, region) let the same module be deployed differently per environment (dev/test/prod) from one set of files plus environment-specific parameter files — the IaC analogue of "build once, promote the same artifact" from the CI/CD section above, applied to infrastructure instead of application binaries.

**A realistic interview framing given likely exposure:** if Bicep usage has mostly been consuming/tweaking existing templates (adding a parameter, adjusting a SKU) rather than authoring a module hierarchy from scratch, say that directly, then pivot to the concepts above (what-if, idempotent reconciliation, module reuse for multi-environment consistency) — those are the parts that demonstrate understanding *why* IaC is structured the way it is, independent of how much hands-on authoring has happened.

## 8. Interview questions with answers and scenarios

### 8.1 Why containerize an app that already runs fine as a VM-deployed JAR?

Containers share the host kernel instead of booting their own, so they start in seconds instead of minutes and pack far more instances per host. More importantly for CI/CD: the image is the *exact* tested artifact — same layers, same dependency versions — promoted unchanged from dev through prod, which a VM-image-per-environment workflow rarely guarantees as cleanly.

### 8.2 What's the actual isolation mechanism behind a container, and where is it weaker than a VM?

Linux namespaces (process tree, network, mounts, hostname, IPC, user IDs) control what a process can *see*; cgroups control what it can *use* (CPU/memory/IO limits). There's no second kernel — every container on a host shares one kernel, so a kernel-level exploit can cross container boundaries in a way a hypervisor escape (VM-to-VM) does not. That's also why Kubernetes nodes are themselves VMs — VM isolation at the node boundary, container density inside it.

### 8.3 Pipeline says deploy succeeded, but the service is down — what's the gap?

Pipeline success usually just means the image built, pushed, and `helm upgrade`/`kubectl apply` was *accepted* by the API server — accepted, not healthy. Check `kubectl describe pod` for the actual state (`CrashLoopBackOff`/`ImagePullBackOff`/`OOMKilled`), then logs for the real exception, then whether an environment-specific ConfigMap/secret/connection string the app expects actually exists in that namespace — missing or stale environment config after a promotion is the most common real-world cause.

### 8.4 Why "build once, promote the same artifact" instead of rebuilding per environment?

Rebuilding per environment risks a different base-image patch, dependency resolution, or build-time flag sneaking in between the staging build and the prod build — exactly the "works in staging, breaks in prod" failure mode a pipeline exists to prevent. Tagging by commit SHA (not `latest`) and pushing that one image through every environment keeps what you tested and what you ship identical.

### 8.5 CPU is low but pods aren't scaling for a queue-backed worker — what's wrong with the setup?

Likely HPA was configured on CPU/memory for a workload whose actual load signal is queue depth/consumer lag, not CPU. HPA only reacts to the metrics it's told to watch; an async worker needs KEDA (Service Bus/Kafka/queue-depth triggers, including scale-to-zero when idle), not a CPU-based HPA, because the pod can be CPU-idle while messages pile up waiting to be picked up.

### 8.6 Rolling update vs. blue/green vs. canary — how do you choose?

Rolling (K8s default) is simplest but exposes some live traffic to a bad new version during the rollout. Blue/green gives an instant, full rollback by flipping traffic back, at the cost of running double infrastructure during the switch. Canary limits blast radius by sending a small traffic slice to the new version first, but only works if you have real-time metrics/alerting wired up to actually detect the canary failing — otherwise you've just added rollout complexity without the safety net it's meant to buy.

### 8.7 Why doesn't the app team usually touch the AKS control plane directly?

AKS is a managed service — Azure runs and patches the API server, scheduler, controller-manager, and `etcd`. The app team interacts with it *indirectly* through every `kubectl`/Helm command (which talks to the API server), but the operational burden of running those control-plane components — upgrades, backups, HA — sits with Azure, not the app team. That's the entire value proposition of "managed Kubernetes" versus self-hosting a cluster.

### 8.8 A trace shows a request spent 4 of its 5 total seconds inside one downstream span — what do you do next, and what if there's no trace at all?

With a trace, go straight to that span's service and pull logs scoped to its trace ID for the same time window — that narrows a vague "it's slow" report to one specific hop and one specific log stream, instead of guessing across every service in the call chain. Without tracing in place (no OTel instrumentation configured, or the header wasn't propagated through a manual HTTP client), you're reduced to correlating timestamps across each service's independent logs by hand — which is exactly the pain tracing exists to remove, and worth naming directly as the gap if asked "how would you debug this without a tracing backend."

### 8.9 A Bicep deployment's `what-if` output shows a resource being deleted that you didn't expect — what does that usually mean, and how do you avoid it reaching prod?

Most often it means the template's declared state no longer includes a resource that exists in Azure — someone (or a prior deployment) created it out-of-band, or a parameter/condition changed and silently dropped a resource block, and Bicep's reconciliation treats "not in the template" as "should not exist." The guard is exactly what `what-if` is for: run it as a required, reviewed gate in the pipeline *before* `deployment group create` applies anything, so an unexpected delete is caught in a PR/approval step rather than discovered after the resource is gone.

### 8.10 Pod keeps restarting, but you don't immediately know why — what's the first thing you check, and what does each likely state actually mean?

`kubectl describe pod` and `kubectl get pod -o wide` first, then logs — but interviewers are really listening for whether you can distinguish the *restart reasons*, because each implies a different fix:

- **`CrashLoopBackOff`** — the container process itself exits (uncaught exception at startup, bad config, failed DB connection at boot). Fix is in application logs, not Kubernetes.
- **`OOMKilled`** — the container hit its memory *limit* and the kernel's cgroup OOM killer terminated it; this is a hard kill, not a graceful shutdown, so `SIGTERM` handlers never ran. Fix is raising the limit or finding the actual leak/misconfigured heap size (`-Xmx` set too close to or above the container limit is the classic JVM version of this).
- **`ImagePullBackOff`** — registry auth, wrong tag, or network policy blocking the node from reaching the registry; nothing to do with the app code at all.
- **Liveness probe failure** (pod shows `Running` but restarts anyway, no crash in logs) — the app is alive but the *probe* can't get a timely 200, often because the probe hits an endpoint doing real work (DB health check) that's slow under load, so Kubernetes kills a pod that was actually fine, just momentarily slow.

Being able to name which log/describe output narrows which of these it is — rather than "I'd check the logs" as a generic answer — is the actual signal interviewers are probing for.

### 8.11 What's the difference between a liveness probe, a readiness probe, and a startup probe — and what happens if you get one wrong?

- **Readiness** — "can this pod take traffic *right now*?" Failing readiness removes the pod from the Service's endpoint list (no traffic routed to it) but does **not** restart it — used for transient conditions like warming a cache or a dependency being briefly unavailable.
- **Liveness** — "has this pod gotten into a state it can't recover from on its own?" Failing liveness **kills and restarts** the container. Getting this wrong is a classic senior-level gotcha: pointing liveness at an endpoint that calls a downstream dependency means a downstream outage causes Kubernetes to restart *every* pod of your app in a cascading loop — the dependency being down doesn't mean your app is broken, so liveness should check the app's own ability to serve traffic, not its dependencies' health.
- **Startup** — for apps with a slow boot (large Spring context, JVM warm-up, cache preload): suppresses liveness/readiness checks until the startup probe itself succeeds, so a legitimately slow-starting app isn't killed by liveness mid-boot before it ever got a chance to become healthy.

A good interview answer explicitly calls out the readiness-vs-liveness distinction as the one engineers get backwards most often, since pointing liveness at a dependency check is a very real production incident shape, not a theoretical trap.

### 8.12 What actually happens when you set resource `requests` and `limits` on a pod, and why does getting `requests` wrong hurt more than getting `limits` wrong?

`requests` is what the scheduler uses to **place** the pod — it finds a node with that much CPU/memory still unallocated and reserves it, regardless of actual usage. `limits` is enforced at runtime by cgroups — CPU gets throttled past the limit (slower, not killed), memory past the limit gets the process `OOMKilled` (hard-killed, not throttled — there's no "slow down" option for memory).

Under-requesting is the subtler failure: if requests are set far below real usage "to fit more pods per node," the scheduler happily overcommits the node, and under real load every pod on that node is fighting for the same physical CPU/memory the node doesn't actually have free — a noisy-neighbor problem the scheduler had no way to see coming, because it only ever looked at `requests`. This is also why a `QoS: Guaranteed` pod (requests == limits) is the most protected class during node pressure/eviction, `Burstable` (requests < limits) is next, and `BestEffort` (no requests/limits set at all) is evicted first.

### 8.13 What's a PodDisruptionBudget (PDB), and why does an app team need to own one even though cluster upgrades are Azure's job?

A PDB declares the minimum pods of a Deployment that must stay available during a **voluntary** disruption — node drains for a cluster/node-pool upgrade, cordoning a node for maintenance, cluster autoscaler scaling a node down. Without a PDB, Kubernetes is free to drain several replicas of your Deployment at once during an AKS node-image upgrade, and if that coincides with your own rolling deployment or a low replica count, you can genuinely lose all serving capacity for a window — even though "upgrading the cluster" is squarely Azure's managed responsibility, *protecting your own app's availability during that upgrade* is the app team's job via a PDB, not Azure's.

### 8.14 How would a senior engineer reason about multi-AZ/zone resilience for an AKS-hosted service, beyond "just add more replicas"?

More replicas alone doesn't buy zone resilience if the scheduler happens to place them all on nodes in the same availability zone — a single zone outage still takes the whole app down. The actual mechanism is a **pod topology spread constraint** (or anti-affinity against the `topology.kubernetes.io/zone` label) telling the scheduler to spread replicas across zones, combined with the node pool itself actually spanning multiple AZs (an AKS node pool can be zone-redundant). It's also worth knowing the limit of this: zone spread protects against an infrastructure-level outage, not an application-level bad deploy — a bad rollout crashes pods in every zone equally, which is a separate problem (canary/rolling strategy, §8.6) that zone spread does nothing for.

### 8.15 A ConfigMap backing an app's config was updated, but the running pods are still using the old values — why, and how do you fix it?

Kubernetes doesn't restart pods automatically when a ConfigMap changes (not even when it's mounted as a volume — a mounted ConfigMap *does* eventually sync to the pod's filesystem, but the app only picks up new values if it re-reads the file, which most Spring Boot apps don't do without `@RefreshScope`/`spring-cloud-config` wired in; env-var-injected ConfigMap values never update at all until the pod restarts, since env vars are fixed at container start). The practical fix most teams use is forcing a rollout on config change — a Helm chart commonly hashes the ConfigMap content into a pod template annotation so any content change forces a new pod spec hash and therefore a rolling restart, rather than relying on the app to hot-reload.

### 8.16 What's the difference between a `Deployment`, a `Service`, and an `Ingress` — and where does an Azure Application Gateway or AGIC fit in?

A **Deployment** manages pod replicas and rollouts. A **Service** provides a stable address and selects backend pods; an **Ingress** declares HTTP host/path routing to Services and needs a compatible controller to implement it. With **AGIC**, the controller configures Application Gateway, which handles requests; an in-cluster proxy controller can instead handle the requests itself. Ingress lets multiple services share an HTTP entry point, but it is not the only way to do so: an external gateway or Gateway API implementation can also provide routing. See the diagrams in §5.
