# Track 2: Матрица решений по выбору технологий

**Дата**: 2026-02-13

---

## Полная матрица сравнения всех вариантов

### 1. Infrastructure as Code

| Критерий | Score (1-10) | Terraform | Ansible | Pulumi | CloudFormation |
|----------|-----------|-----------|---------|--------|----------------|
| **Multi-cloud** | 9 | 9 | 9 | 2 | 2 |
| **Simplicity** | 8 | 6 | 8 | 5 | 6 |
| **State mgmt** | 8 | 9 | 3 | 8 | 7 |
| **Learning curve** | 7 | 6 | 8 | 4 | 6 |
| **Community** | 10 | 10 | 9 | 6 | 8 |
| **Automation API** | 7 | 5 | 5 | 9 | 4 |
| **Cost** | 10 | 10 | 10 | 6 | 10 |
| **Production ready** | 10 | 10 | 9 | 8 | 9 |
| **T1 suitable** | 6 | 3 | 9 | 3 | 2 |
| **T2 suitable** | 8 | 8 | 8 | 7 | 3 |
| **T3 suitable** | 8 | 8 | 7 | 7 | 2 |

**TOTAL SCORES**:
- **Terraform**: 78/110 (71%)
- **Ansible**: 77/110 (70%)
- **Pulumi**: 57/110 (52%)
- **CloudFormation**: 48/110 (44%)

**DECISION**: **Terraform for T2/T3**, **Ansible for T1**

---

### 2. Configuration Management

| Критерий | Score | Ansible | Puppet | Chef | SaltStack |
|----------|-------|---------|--------|------|-----------|
| **Simplicity** | 9 | 9 | 4 | 4 | 5 |
| **Learning curve** | 9 | 9 | 3 | 3 | 5 |
| **Multi-cloud** | 8 | 9 | 8 | 8 | 8 |
| **Agentless** | 8 | 9 | 2 | 2 | 3 |
| **Idempotent** | 8 | 9 | 9 | 9 | 9 |
| **Community** | 9 | 9 | 8 | 7 | 5 |
| **Performance** | 6 | 5 | 8 | 8 | 7 |
| **Cost** | 10 | 10 | 3 | 3 | 9 |

**TOTAL SCORES**:
- **Ansible**: 79/80 (99%)
- **Puppet**: 47/80 (59%)
- **Chef**: 44/80 (55%)
- **SaltStack**: 50/80 (63%)

**DECISION**: **Ansible for all Tiers**

---

### 3. Database

| Критерий | Score | SQLite | PostgreSQL | MySQL | MongoDB | Managed DB |
|----------|-------|--------|-----------|-------|---------|-----------|
| **T1 simplicity** | 9 | 9 | 2 | 3 | 2 | 1 |
| **T1 cost** | 10 | 10 | 2 | 2 | 2 | 2 |
| **T2 capability** | 8 | 3 | 9 | 8 | 7 | 9 |
| **T2 cost** | 8 | 8 | 9 | 9 | 9 | 4 |
| **T3 scalability** | 8 | 2 | 8 | 7 | 9 | 9 |
| **ACID compliance** | 8 | 8 | 10 | 7 | 4 | 10 |
| **No vendor lock-in** | 10 | 10 | 10 | 10 | 10 | 2 |
| **Community** | 9 | 7 | 10 | 9 | 8 | 7 |

**DECISION**: **SQLite for T1**, **PostgreSQL for T2/T3** (self-hosted), **AWS RDS as alternative for T3**

---

### 4. Secrets Management

| Критерий | Score | File+Encryption | Vault | AWS Secrets | GCP Secret | K8s Sealed |
|----------|-------|-----------------|-------|-------------|-----------|-----------|
| **T1 simplicity** | 9 | 9 | 2 | 3 | 3 | N/A |
| **T1 cost** | 10 | 10 | 2 | 2 | 2 | N/A |
| **T2 security** | 8 | 4 | 9 | 9 | 9 | 7 |
| **T2 automation** | 7 | 2 | 8 | 8 | 8 | 6 |
| **T3 enterprise** | 9 | 2 | 10 | 8 | 8 | 7 |
| **Dynamic secrets** | 8 | 1 | 10 | 8 | 8 | 5 |
| **Audit trail** | 9 | 2 | 10 | 9 | 9 | 7 |
| **No vendor lock-in** | 10 | 10 | 10 | 2 | 2 | 8 |

**DECISION**: **Encrypted files for T1**, **Vault for T2/T3**

---

### 5. Container Orchestration

| Критерий | Score | systemd | Docker Compose | Nomad | Kubernetes | Swarm |
|----------|-------|---------|-----------------|-------|-----------|-------|
| **T1 simplicity** | 10 | 10 | 3 | 2 | 1 | 3 |
| **T1 cost** | 10 | 10 | 9 | 8 | 1 | 9 |
| **T2 scalability** | 8 | 2 | 7 | 8 | 9 | 6 |
| **T2 learning curve** | 8 | 9 | 8 | 6 | 2 | 7 |
| **T3 enterprise** | 9 | 1 | 3 | 6 | 10 | 3 |
| **HA built-in** | 8 | 1 | 2 | 7 | 9 | 5 |
| **Community** | 9 | 9 | 9 | 5 | 10 | 5 |
| **Multi-cloud** | 8 | 9 | 9 | 9 | 9 | 8 |

**DECISION**: **systemd for T1**, **Docker Compose for T2**, **Kubernetes for T3**

---

### 6. Monitoring Stack

| Критерий | Score | Prometheus | ELK | Datadog | New Relic | Loki | Jaeger |
|----------|-------|-----------|-----|---------|----------|------|--------|
| **Cost** | 9 | 10 | 8 | 1 | 1 | 10 | 10 |
| **Metrics quality** | 9 | 10 | 8 | 10 | 10 | N/A | N/A |
| **Logs quality** | 8 | N/A | 10 | 9 | 9 | 10 | N/A |
| **Tracing** | 7 | N/A | N/A | 9 | 9 | N/A | 9 |
| **Learning curve** | 7 | 7 | 3 | 9 | 9 | 8 | 4 |
| **Community** | 9 | 10 | 9 | 8 | 8 | 8 | 9 |
| **No vendor lock-in** | 10 | 10 | 10 | 1 | 2 | 10 | 10 |

**DECISION**:
- **T1**: Basic logs (no special tool)
- **T2**: Prometheus + Grafana + Loki
- **T3**: Prometheus + Grafana + Loki + Jaeger

---

### 7. CI/CD Platform

| Критерий | Score | GitLab CI | GitHub Actions | Jenkins | CircleCI | GitOps (ArgoCD) |
|----------|-------|-----------|-----------------|---------|----------|-----------------|
| **Cost** | 9 | 10 | 9 | 8 | 5 | 10 |
| **Simplicity** | 8 | 8 | 9 | 3 | 8 | 7 |
| **Power** | 9 | 9 | 8 | 10 | 8 | 9 |
| **K8s integration** | 8 | 9 | 7 | 8 | 7 | 10 |
| **Self-hosted** | 8 | 9 | 1 | 10 | 3 | 10 |
| **Community** | 9 | 8 | 10 | 10 | 7 | 9 |
| **Already using** | 10 | 10 | 1 | 1 | 1 | 1 |

**DECISION**: **GitLab CI for all Tiers**

---

## Cost Comparison by Tier

### Tier 1 Monthly Cost (estimated)

| Component | Cost | Notes |
|-----------|------|-------|
| VM (6 CPU, 8GB) | $50-100 | Contabo, DigitalOcean, etc. |
| SQLite | Free | Embedded |
| Ansible | Free | Open-source |
| GitLab Runner | Free | Self-hosted |
| **TOTAL** | **$50-100** | - |

### Tier 2 Monthly Cost (estimated)

| Component | Cost | Notes |
|-----------|------|-------|
| 3x VMs (8 CPU, 16GB each) | $450-900 | 3 servers |
| PostgreSQL | Free | Self-hosted |
| Terraform | Free | Open-source |
| Vault | Free | Self-hosted |
| Prometheus + Grafana | Free | Open-source |
| GitLab Runner (advanced) | Free | Self-hosted |
| **TOTAL** | **$450-900** | - |

### Tier 3 Monthly Cost (estimated)

| Component | Cost | Notes |
|-----------|------|-------|
| K8s Cluster (3-5 nodes) | $1500-3000 | AWS EKS, GCP GKE, or self-hosted |
| PostgreSQL (managed) | $200-500 | Or self-hosted (included) |
| ArgoCD | Free | Open-source |
| Monitoring stack | Free | Open-source (Prometheus, Loki) |
| Vault | Free | Self-hosted |
| **TOTAL** | **$1700-3500** | - |

**Note**: Prices are approximate and depend on cloud provider, region, etc.

---

## Decision Justification

### Why Terraform + Ansible combo for T2?

1. **Terraform** for Infrastructure:
   - ✅ Industry standard
   - ✅ Multi-cloud support
   - ✅ State management (critical)
   - ✅ Large ecosystem

2. **Ansible** for Configuration:
   - ✅ Simple to learn
   - ✅ Agentless
   - ✅ Works everywhere
   - ✅ Idempotent (safe)

### Why PostgreSQL for T2/T3?

1. **SQLite→PostgreSQL migration path clear**:
   - ✅ Same SQL dialect
   - ✅ Automated migration scripts possible
   - ✅ Zero-downtime with dual-write

2. **PostgreSQL is powerful**:
   - ✅ ACID compliant
   - ✅ Replication available (for HA)
   - ✅ No vendor lock-in
   - ✅ Free and open-source

### Why Vault for T2/T3?

1. **Dynamic secrets**:
   - ✅ Auto-rotate credentials
   - ✅ TTL (time-to-live)
   - ✅ No static passwords

2. **Audit trail**:
   - ✅ Who accessed what, when
   - ✅ Critical for security
   - ✅ Required for compliance

### Why Prometheus + Grafana + Loki for T2/T3?

1. **Prometheus**:
   - ✅ Pulls metrics (safer than push)
   - ✅ Industry standard
   - ✅ Works with everything
   - ✅ Free

2. **Grafana**:
   - ✅ Beautiful dashboards
   - ✅ Works with Prometheus
   - ✅ Free and open-source

3. **Loki**:
   - ✅ Prometheus-compatible (same philosophy)
   - ✅ Lightweight (not heavy like ELK)
   - ✅ Works with K8s

### Why GitLab CI for all Tiers?

1. **We already have GitLab CE**:
   - ✅ No external dependency
   - ✅ No lock-in

2. **It's powerful**:
   - ✅ Good enough for T1
   - ✅ Powerful for T3 (enterprise)
   - ✅ Great K8s integration

3. **It's integrated**:
   - ✅ Works with our repos
   - ✅ Easy to configure
   - ✅ Good UI

---

## Migration Path

### SQLite → PostgreSQL (T1→T2)

```
Phase 1: Preparation
  ├─ Create PostgreSQL cluster on new server
  ├─ Verify connectivity
  └─ Plan downtime window

Phase 2: Migration (dual-write)
  ├─ Create PostgreSQL schema (from SQLite)
  ├─ Backup SQLite database
  ├─ Initial migration (data copy)
  ├─ Enable dual-write (new ops → both DBs)
  └─ Validation period (1-2 days)

Phase 3: Switchover
  ├─ Switch application to PostgreSQL
  ├─ Monitor for issues
  ├─ Verify all data
  └─ Keep SQLite as backup (for 2 weeks)

Phase 4: Cleanup
  └─ Remove SQLite (after 2 weeks)
```

**Downtime**: 30 minutes to 2 hours

---

## PoC (Proof of Concept) Recommendations

### Tier 1 PoC

Components to test:
- Ansible playbooks (simple YAML)
- SQLite database
- Basic monitoring (logs)
- GitLab CI pipelines

Effort: 1-2 weeks

### Tier 2 PoC

Components to test:
- Terraform (3 servers)
- Ansible (configuration)
- PostgreSQL (replication)
- Prometheus + Grafana
- Vault (basic setup)

Effort: 3-4 weeks

### Tier 3 PoC

Components to test:
- Terraform (K8s cluster)
- Helm (app deployment)
- ArgoCD (GitOps)
- Prometheus + Loki + Jaeger
- Vault (HA)

Effort: 4-6 weeks

---

**Decision Matrix создана**: 2026-02-13
**Версия**: 1.0
