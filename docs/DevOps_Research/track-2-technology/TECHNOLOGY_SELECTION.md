# Track 2: Выбор технологического стека

**Дата**: 2026-02-13
**Статус**: Начало исследования
**Ответственный**: Track 2 Lead (DevOps & Cloud Architecture Expert)

---

## 📋 Резюме

Этот документ анализирует и выбирает технологии для каждого компонента системы для всех трех Tier'ов.

**Подход**:
- Для каждого компонента: анализ вариантов, scoring matrix, final recommendation
- Обоснование: почему выбранная технология лучше
- Trade-offs: какие компромиссы делаем

---

## 1. Infrastructure as Code (IaC)

### Вариант 1: Terraform

**Описание**: State-driven, HCL language, multi-cloud

**Плюсы**:
- ✅ Multi-cloud (AWS, GCP, Azure, on-prem)
- ✅ State management (knows desired vs actual)
- ✅ Large ecosystem (AWS providers, etc.)
- ✅ Widely adopted (huge community)
- ✅ Remote state support (S3, Terraform Cloud)
- ✅ Modules for reusability
- ✅ Works with K8s (Kubernetes provider)

**Минусы**:
- ❌ HCL language (not a standard programming language)
- ❌ State file management complexity
- ❌ Learning curve (not trivial for beginners)
- ❌ Can be slow for large infrastructure

**Сложность**: Medium-High
**Для какого Tier**: Tier 2 & 3 (not Tier 1)

### Вариант 2: Ansible

**Описание**: Configuration management, YAML-based, agentless

**Плюсы**:
- ✅ Simple YAML syntax (easy to learn)
- ✅ Agentless (no agents to install)
- ✅ Multi-cloud (can manage anywhere)
- ✅ Large community
- ✅ Great for configuration management
- ✅ Good for Tier 1 (simple)
- ✅ Idempotent (safe to run multiple times)

**Минусы**:
- ❌ Not true state management (imperative)
- ❌ Can be slow (Python-based, no parallel by default)
- ❌ Not ideal for IaC (more for config)
- ❌ State tracking not built-in

**Сложность**: Low
**Для какого Tier**: Tier 1 & 2 (pair with Terraform in Tier 2)

### Вариант 3: Pulumi

**Описание**: Modern IaC, programmatic (Python/Go/TypeScript)

**Плюсы**:
- ✅ Real programming languages (Python, Go, TypeScript)
- ✅ Powerful (full language capabilities)
- ✅ Type-safe (especially TypeScript)
- ✅ Automation API (can embed in tools)
- ✅ Multi-cloud
- ✅ State management

**Минусы**:
- ❌ Smaller ecosystem than Terraform
- ❌ Steeper learning curve (need programming knowledge)
- ❌ Less adoption (less community resources)
- ❌ Costs for Pulumi Cloud (unless self-hosted)

**Сложность**: Medium-High
**Для какого Tier**: Could be used in Tier 2/3 (if team knows programming)

### Вариант 4: CloudFormation (AWS-specific)

**Описание**: AWS native IaC, JSON/YAML

**Плюсы**:
- ✅ AWS-native (perfect integration)
- ✅ Simple for AWS resources
- ✅ No learning curve for AWS users

**Минусы**:
- ❌ AWS-only (vendor lock-in)
- ❌ Verbose (lots of boilerplate)
- ❌ Limited community (AWS ecosystem)
- ❌ No multi-cloud support
- ❌ Against our design principle (multi-cloud)

**Сложность**: Medium
**Для какого Tier**: ❌ NOT RECOMMENDED (vendor lock-in)

### Decision Matrix

| Критерий | Terraform | Ansible | Pulumi | CloudFormation |
|----------|-----------|---------|--------|----------------|
| **Multi-cloud** | 9/10 | 9/10 | 9/10 | 2/10 |
| **Simplicity** | 6/10 | 8/10 | 5/10 | 6/10 |
| **State management** | 9/10 | 3/10 | 8/10 | 7/10 |
| **Learning curve** | 7/10 (Medium) | 9/10 (Easy) | 5/10 (Hard) | 7/10 (Medium) |
| **Community** | 10/10 | 9/10 | 6/10 | 8/10 |
| **Automation API** | 5/10 | 5/10 | 9/10 | 4/10 |
| **Cost** | Free | Free | Freemium | Free |

### 🎯 РЕКОМЕНДАЦИЯ

| Tier | Выбор | Обоснование |
|------|-------|------------|
| **Tier 1** | Ansible | Simple YAML, no state complexity, easy for beginners |
| **Tier 2** | Terraform | Good balance, multi-cloud, proven, widely used |
| **Tier 3** | Terraform + Helm | Terraform for infra, Helm for K8s apps |

---

## 2. Configuration Management

### Вариант 1: Ansible

**Описание**: YAML-based, agentless, simple

**Плюсы**:
- ✅ Simple YAML syntax
- ✅ Agentless (low overhead)
- ✅ Idempotent
- ✅ Multi-cloud
- ✅ Large community
- ✅ Good for simple config changes

**Минусы**:
- ❌ Can be slow (serial by default)
- ❌ Limited for complex deployments
- ❌ No state tracking

**Для Tier**: 1, 2, 3 (all)

### Вариант 2: Puppet

**Описание**: Agent-based, declarative, complex

**Плюсы**:
- ✅ Powerful
- ✅ Declarative
- ✅ Agent provides real-time config management

**Минусы**:
- ❌ Complex (steep learning curve)
- ❌ Requires agents (overhead)
- ❌ More expensive (enterprise pricing)
- ❌ Overkill for simple setups

**Для Tier**: ❌ Too complex

### Вариант 3: Chef

**Описание**: Ruby-based, powerful, complex

**Плюсы**:
- ✅ Powerful
- ✅ Large community

**Минусы**:
- ❌ Complex (Ruby knowledge needed)
- ❌ Steep learning curve
- ❌ Overkill for simple setups

**Для Tier**: ❌ Too complex for Tier 1/2

### 🎯 РЕКОМЕНДАЦИЯ

**Ansible for all Tiers**
- Simple, agentless, multi-cloud
- Pair with Terraform in Tier 2/3
- In Tier 1, used for app/service configuration

---

## 3. Database

### Tier 1: SQLite

**Описание**: Embedded, file-based, serverless

**Плюсы**:
- ✅ No installation needed (embedded)
- ✅ Zero configuration
- ✅ Lightweight (perfect for Tier 1)
- ✅ ACID compliant
- ✅ SQL standard

**Минусы**:
- ❌ Single-process (can't handle concurrency well)
- ❌ No remote access (file-based)
- ❌ Not ideal for multi-user
- ❌ Slower than PostgreSQL
- ❌ Must migrate to PostgreSQL for Tier 2

**Когда выбрать**: Tier 1 (Starter)

### Tier 2/3: PostgreSQL

**Описание**: Open-source, powerful, mature

**Плюсы**:
- ✅ Powerful (full SQL, JSON, etc.)
- ✅ Reliable (ACID, proven)
- ✅ Multi-user support
- ✅ Replication available
- ✅ Free and open-source
- ✅ Large community
- ✅ No vendor lock-in

**Минусы**:
- ❌ More ops work (manage server)
- ❌ Not serverless (need to provision)

**Когда выбрать**: Tier 2 & 3 (standard choice)

### Alternative: MySQL/MariaDB

**Описание**: Open-source, simpler than PostgreSQL

**Плюсы**:
- ✅ Simpler than PostgreSQL
- ✅ Good performance
- ✅ Widespread

**Минусы**:
- ❌ Less powerful than PostgreSQL
- ❌ Not our first choice

**Когда выбрать**: Only if team already knows MySQL

### Alternative for Tier 3: Managed Databases

**Options**:
- AWS RDS (PostgreSQL, MySQL)
- Google Cloud SQL
- Azure Database

**Плюсы**:
- ✅ No ops work (managed)
- ✅ Automatic backups
- ✅ High availability built-in

**Минусы**:
- ❌ Vendor lock-in
- ❌ More expensive than self-hosted

**Когда выбрать**: If team doesn't want ops work (choose AWS RDS for Tier 3)

### 🎯 РЕКОМЕНДАЦИЯ

| Tier | Database | Reason |
|------|----------|--------|
| **Tier 1** | SQLite | Simple, no setup |
| **Tier 2** | PostgreSQL (self-hosted) | Good balance, free, no lock-in |
| **Tier 3** | PostgreSQL (self-hosted) OR AWS RDS | Self-hosted if ops team, RDS if want managed |

**Migration path**: SQLite (T1) → PostgreSQL (T2/3)
- Automated migration scripts provided
- Zero-downtime with dual-write phase

---

## 4. Secrets Management

### Tier 1: File-based + Encryption

**Описание**: Simple encrypted files

**Плюсы**:
- ✅ Simple (no extra tools)
- ✅ Works everywhere
- ✅ Can be in Git (encrypted)
- ✅ No external dependencies

**Минусы**:
- ❌ No rotation
- ❌ No audit trail
- ❌ Manual management
- ❌ Not enterprise-ready

**Для Tier 1**: ✅ Acceptable (simple is good)

### Tier 2/3: Vault

**Описание**: HashiCorp Vault, enterprise secrets management

**Плюсы**:
- ✅ Enterprise-grade (built for security)
- ✅ Dynamic secrets (auto-rotate)
- ✅ Audit logging (full trail)
- ✅ Multi-cloud
- ✅ Free and open-source (self-hosted)
- ✅ Encryption at rest
- ✅ TTL support (secrets auto-expire)

**Минусы**:
- ❌ Complexity (HA requires Raft cluster)
- ❌ Learning curve
- ❌ Need to maintain Vault cluster

**Для Tier 2/3**: ✅ Best choice

### Alternative: AWS Secrets Manager

**Описание**: AWS managed secrets

**Плюсы**:
- ✅ Managed (no ops work)
- ✅ Integrated with AWS

**Минусы**:
- ❌ AWS-only (vendor lock-in)
- ❌ More expensive
- ❌ Against our multi-cloud principle

**Для Tier 3**: ⚠️ Only if AWS-only deployment

### Alternative: GCP Secret Manager

**Same as AWS**: Good if GCP, but vendor lock-in

### 🎯 РЕКОМЕНДАЦИЯ

| Tier | Secrets Management | Reason |
|------|-------------------|--------|
| **Tier 1** | Encrypted files + Git | Simple, works, acceptable for small scale |
| **Tier 2** | Vault (self-hosted) | Enterprise-grade, dynamic secrets, audit |
| **Tier 3** | Vault (self-hosted) | Same as Tier 2, but with HA setup |

---

## 5. Container Orchestration

### Tier 1: systemd (no orchestration)

**Описание**: OS-level process manager

**Плюсы**:
- ✅ Already installed (no new tools)
- ✅ Simple for single-server
- ✅ Reliable

**Минусы**:
- ❌ Not real orchestration (single-server only)
- ❌ No scaling

**Для Tier 1**: ✅ Good enough

### Tier 2: Docker + Docker Compose

**Описание**: Containerization + simple orchestration

**Плюсы**:
- ✅ Simple (easy to learn)
- ✅ Good for multi-server
- ✅ Container benefits (reproducibility)
- ✅ compose for local orchestration
- ✅ shell runner can handle it

**Минусы**:
- ❌ No HA (single orchestration point)
- ❌ Limited scaling
- ❌ Not designed for 100s of services

**Для Tier 2**: ✅ Good choice

### Tier 3: Kubernetes

**Описание**: Enterprise container orchestration

**Плюсы**:
- ✅ Enterprise-grade (designed for scale)
- ✅ Self-healing
- ✅ Auto-scaling
- ✅ Multi-region capable
- ✅ Industry standard (huge ecosystem)
- ✅ HA built-in

**Минусы**:
- ❌ Complex (steep learning curve)
- ❌ Overhead (even for small clusters)
- ❌ Requires real ops team
- ❌ Overkill for small deployments

**Для Tier 3**: ✅ Required for enterprise

### Alternative for Tier 2: Nomad

**Описание**: HashiCorp Nomad, flexible orchestration

**Плюсы**:
- ✅ Can run Docker + raw binaries
- ✅ Simpler than K8s
- ✅ Multi-cloud

**Минусы**:
- ❌ Smaller ecosystem
- ❌ Less adoption

**Для Tier 2**: ⚠️ Could use instead of Docker Compose if need more power

### 🎯 РЕКОМЕНДАЦИЯ

| Tier | Orchestration | Reason |
|------|---------------|--------|
| **Tier 1** | systemd | Single-server, simple |
| **Tier 2** | Docker + Docker Compose | Good balance, simple, scalable to 3-5 servers |
| **Tier 3** | Kubernetes | Enterprise requirement |

---

## 6. Monitoring & Observability

### Metrics: Prometheus

**Описание**: Time-series metrics database

**Плюсы**:
- ✅ Industry standard for metrics
- ✅ Open-source (free)
- ✅ Pulls metrics (safe)
- ✅ Works with K8s, Docker, VMs
- ✅ Large ecosystem (exporters)
- ✅ Alerting built-in

**Минусы**:
- ❌ Time-series only (no logs)
- ❌ Local storage (need to manage retention)
- ❌ Not great for 100% uptime (single instance bottleneck)

**Для Tier**: 2, 3

### Visualization: Grafana

**Описание**: Metrics visualization and dashboards

**Плюсы**:
- ✅ Beautiful dashboards
- ✅ Works with Prometheus
- ✅ Free and open-source
- ✅ Large community

**Минусы**:
- ❌ Not a database (just visualization)
- ❌ Requires Prometheus for data

**Для Tier**: 2, 3 (with Prometheus)

### Logs: Loki vs ELK

**Loki**:
- Prometheus-compatible
- Lightweight
- Good for medium scale

**ELK (Elasticsearch, Logstash, Kibana)**:
- More powerful
- Better for large scale
- More complex

**Для Tier 2**: Loki (simpler)
**Для Tier 3**: ELK or Loki (depending on team)

### Tracing: Jaeger

**Описание**: Distributed tracing

**Плюсы**:
- ✅ Understand request flow across services
- ✅ Open-source
- ✅ Works with K8s

**Минусы**:
- ❌ Requires instrumentation (code changes)
- ❌ Adds complexity

**Для Tier**: 3 only (optional but recommended)

### 🎯 РЕКОМЕНДАЦИЯ

| Tier | Monitoring | Components |
|------|-----------|------------|
| **Tier 1** | Basic logs | systemd logs, email alerts |
| **Tier 2** | Prometheus + Grafana + Loki | Metrics, dashboards, logs |
| **Tier 3** | Full stack | Prometheus + Grafana + Loki + Jaeger |

---

## 7. CI/CD Platform

### Tier 1/2: GitHub Actions or GitLab CI

**GitHub Actions**:
- ✅ Integrated with GitHub
- ✅ Free (for public repos)
- ✅ Simple YAML workflows

**GitLab CI**:
- ✅ Integrated with GitLab (we use CE)
- ✅ Free
- ✅ Powerful
- ✅ No external dependency (self-hosted)

**Для Tier 1/2**: ✅ Use GitLab CI (we already have CE)

### Tier 3: Jenkins or advanced GitLab CI

**Jenkins**:
- ✅ Open-source
- ✅ Powerful (plugins)
- ✅ Self-hosted

**Минусы**:
- ❌ Complex
- ❌ More ops work
- ❌ Older technology

**GitLab CI** (advanced):
- ✅ Can handle Tier 3 complexity
- ✅ Already using it
- ✅ Excellent for K8s

**Для Tier 3**: ✅ Stick with GitLab CI (proven)

### 🎯 РЕКОМЕНДАЦИЯ

**All Tiers: GitLab CI**
- Already have GitLab CE
- Powerful enough for all tiers
- No external dependency
- Good integration with our Management UI

---

## 8. Service Mesh (Tier 3 only)

### Option 1: Istio

**Описание**: Powerful, feature-rich service mesh

**Плюсы**:
- ✅ Most mature
- ✅ Full feature set
- ✅ Large community

**Минусы**:
- ❌ Complex (hard to debug)
- ❌ Resource overhead
- ❌ Learning curve

**Для Tier 3**: ⚠️ Optional (only if team knows K8s well)

### Option 2: Linkerd

**Описание**: Lighter-weight alternative

**Плюсы**:
- ✅ Simpler than Istio
- ✅ Lower resource overhead
- ✅ Easier to debug

**Минусы**:
- ❌ Smaller ecosystem
- ❌ Less features

**Для Tier 3**: ✅ Recommended (simpler than Istio)

### Option 3: No service mesh

**Плюсы**:
- ✅ Simpler (one less thing)
- ✅ Less overhead
- ✅ Easier to debug

**Минусы**:
- ❌ Less networking features
- ❌ Manual traffic management

**Для Tier 3**: ✅ Also OK (don't need mesh for MVP)

### 🎯 РЕКОМЕНДАЦИЯ

**Tier 3**: Optional (Linkerd if needed, else skip for MVP)

---

## 9. GitOps Controller (Tier 2/3)

### Tier 2: GitHub Actions / GitLab CI (webhook-based)

Already covered in CI/CD section

### Tier 3: ArgoCD

**Описание**: Kubernetes GitOps controller

**Плюсы**:
- ✅ Pull-based (safer)
- ✅ Self-healing
- ✅ Works with K8s
- ✅ Great UI
- ✅ Free and open-source

**Минусы**:
- ❌ K8s-only
- ❌ Learning curve

**Для Tier 3**: ✅ Standard choice

### Alternative: Flux

**Similar to ArgoCD**: Also good, slightly simpler

**Для Tier 3**: ⚠️ Alternative to ArgoCD

### 🎯 РЕКОМЕНДАЦИЯ

**Tier 2**: GitLab CI with webhooks
**Tier 3**: ArgoCD (with K8s)

---

## 10. Summary Tech Stack by Tier

### 🟢 Tier 1 (Starter)

```
Infrastructure as Code:     Ansible (simple YAML)
Database:                   SQLite (embedded)
Secrets:                    Encrypted files
Config Management:          Ansible
Container Orchestration:    systemd (single-server)
Monitoring:                 systemd logs
CI/CD:                      GitLab CI
Service Mesh:               N/A
```

### 🟡 Tier 2 (Professional)

```
Infrastructure as Code:     Terraform (+ Ansible)
Database:                   PostgreSQL
Secrets:                    Vault (self-hosted)
Config Management:          Ansible
Container Orchestration:    Docker + Docker Compose
Monitoring:                 Prometheus + Grafana + Loki
CI/CD:                      GitLab CI (advanced)
Service Mesh:               N/A
GitOps:                     Webhook-based (GitLab CI)
```

### 🔴 Tier 3 (Enterprise)

```
Infrastructure as Code:     Terraform + Helm
Database:                   PostgreSQL (or AWS RDS)
Secrets:                    Vault (HA cluster)
Config Management:          Helm + Kustomize
Container Orchestration:    Kubernetes
Monitoring:                 Prometheus + Grafana + Loki + Jaeger
CI/CD:                      GitLab CI (enterprise)
Service Mesh:               Linkerd (optional)
GitOps:                      ArgoCD
```

---

## 10. Infrastructure Maintenance & Automation (OS, Proxmox, Cloud)

### Tier 1: Basic Automation

**Tasks to automate**:
- Security OS updates (automatic)
- Disk cleanup (logs, temp files, Docker cache)
- Daily VM snapshots
- Backup rotation (keep 30 days, delete old)
- Health monitoring (CPU, memory, disk, SMART)

**Tools**:
- cron jobs (built-in)
- Agent automation (Claude-based)
- Cloud provider APIs (DigitalOcean, Contabo)

**Cost**: ~$0 (uses existing tools)

### Tier 2: Advanced Automation

**Additional tasks**:
- Bug-fix OS updates (auto-approve)
- Auto CPU/memory resize (if safe)
- Disk expansion (when > 90% full)
- Proxmox management (snapshots, firewall)
- Cost monitoring and budgeting

**Tools**:
- Proxmox API (if using Proxmox)
- Cloud APIs (DigitalOcean, Hetzner)
- Agent automation (extended)
- Terraform integration (some operations)

**Cost control**:
- Daily limit: $10 (alert at $8)
- Monthly limit: $200 (stop at $180)
- Estimate costs before operations

### Tier 3: Full Automation

**Additional tasks**:
- K8s node management (auto-scale, auto-repair)
- Disaster recovery orchestration
- Multi-region failover
- Advanced capacity planning
- Performance optimization automation

**Tools**:
- K8s operators and controllers
- Prometheus for triggering (based on metrics)
- Helm for K8s deployments
- ArgoCD for GitOps-driven infrastructure

### 🎯 РЕКОМЕНДАЦИЯ

**Infrastructure Maintenance Automation must be integrated into Agent**:

| Task | Tier 1 | Tier 2 | Tier 3 | Automation Level |
|------|--------|--------|--------|------------------|
| Security updates | ✅ Auto | ✅ Auto | ✅ Auto | Level 0 |
| Disk cleanup | ✅ Auto | ✅ Auto | ✅ Auto | Level 0 |
| Snapshots/backups | ✅ Daily | ✅ Daily | ✅ Daily | Level 0 |
| CPU/Memory resize | ⚠️ Manual | ✅ Auto | ✅ Auto | Level 1 |
| Kernel updates | ⚠️ Manual | ⚠️ Approval | ⚠️ Approval | Level 2 |
| Cost optimization | ⚠️ Manual | ✅ Auto | ✅ Auto | Level 1 |
| Multi-region failover | N/A | N/A | ✅ Auto | Level 1 |

**Expected automation saves**: 24+ hours/month (1 FTE per tier)

---

## 11. Open Questions for Deep Dive

1. **SQLite migration**: Exactly how to do zero-downtime SQLite→PostgreSQL?
2. **Vault HA**: How to set up Vault cluster for Tier 2?
3. **Docker registry**: Where to host Docker images?
4. **Helm charts**: How to create helm charts for our services?
5. **Loki vs ELK**: Which one is better for our scale?
6. **ArgoCD vs Flux**: Which one easier to manage?
7. **K8s platform**: Which K8s distribution (EKS, GKE, self-hosted)?
8. **Infrastructure maintenance**: Proxmox API integration depth and auto-scaling limits?
9. **Cost automation**: How to safely implement spending limits without blocking critical operations?
10. **Maintenance levels**: Which auto-approval thresholds for CPU/memory/disk scaling?

---

**Документ создан**: 2026-02-13
**Версия**: 1.0 (Draft)
**Статус**: Core selections done, need POC validation
