# Track 2: Резюме выбора технологического стека

**Дата**: 2026-02-13
**Статус**: ✅ Основной выбор завершен

---

## 🎯 Рекомендуемый стек

### Tier 1 (Starter): Simple & Minimal

```yaml
# Infrastructure & Config
IaC:                    Ansible (YAML)
Config Management:      Ansible

# Data & State
Database:               SQLite (embedded, zero config)
Secrets:                Encrypted files + Git

# Operations
Orchestration:          systemd (single-server)
CI/CD:                  GitLab CI

# Monitoring
Observability:          Basic systemd logs
Alerting:               Email

# Cost: $50-100/month (just VM)
```

**Why simple?**: Starters don't need complexity. Ansible + SQLite = works out of the box.

---

### Tier 2 (Professional): Balanced

```yaml
# Infrastructure & Config
IaC:                    Terraform
Config Management:      Ansible

# Data & State
Database:               PostgreSQL (3 servers)
Secrets:                Vault (self-hosted)

# Operations
Orchestration:          Docker + Docker Compose
CI/CD:                  GitLab CI (advanced)

# Monitoring
Metrics:                Prometheus
Visualization:          Grafana
Logs:                   Loki
Tracing:                N/A

# Observability Stack is free (open-source)
# Cost: $450-900/month (3 servers)
```

**Why Terraform?**: Industry standard, multi-cloud, state management (critical for T2).
**Why Vault?**: Dynamic secrets, auto-rotation, audit trail (required for growing teams).

---

### Tier 3 (Enterprise): Full Power

```yaml
# Infrastructure & Config
IaC:                    Terraform + Helm
Config Management:      Helm + Kustomize

# Data & State
Database:               PostgreSQL (managed or self-hosted)
Secrets:                Vault (HA cluster)

# Operations
Orchestration:          Kubernetes
GitOps:                 ArgoCD
CI/CD:                  GitLab CI (enterprise)

# Monitoring
Metrics:                Prometheus
Visualization:          Grafana
Logs:                   Loki
Tracing:                Jaeger

# Cost: $1500-3500/month (K8s cluster)
```

**Why K8s?**: Enterprise standard, auto-scaling, multi-region capable, self-healing.
**Why ArgoCD?**: GitOps (Git = source of truth), pull-based (safer), self-healing.

---

## 📊 Score Summary

### IaC (Infrastructure as Code)

| Option | Score | Notes |
|--------|-------|-------|
| **Terraform** | 78/110 | Winner for T2/T3 (71%) |
| Ansible | 77/110 | Good for T1 (70%) |
| Pulumi | 57/110 | Could work (52%) |
| CloudFormation | 48/110 | ❌ Avoid (vendor lock-in) |

### Config Management

| Option | Score | Notes |
|--------|-------|-------|
| **Ansible** | 79/80 | Clear winner (99%) for all tiers |
| Puppet | 47/80 | Too complex (59%) |
| Chef | 44/80 | Too complex (55%) |
| SaltStack | 50/80 | Less popular (63%) |

### Database

| Tier | Choice | Score | Reason |
|------|--------|-------|--------|
| **T1** | **SQLite** | 10/10 | Zero config, embedded |
| **T2** | **PostgreSQL** | 9/10 | Powerful, free, no lock-in |
| **T3** | **PostgreSQL** | 9/10 | Same as T2 |

### Secrets Management

| Tier | Choice | Score | Reason |
|------|--------|-------|--------|
| **T1** | **Encrypted files** | 9/10 | Simple, effective |
| **T2** | **Vault** | 9/10 | Dynamic secrets, audit |
| **T3** | **Vault (HA)** | 10/10 | Enterprise-grade |

### Container Orchestration

| Tier | Choice | Score | Reason |
|------|--------|-------|--------|
| **T1** | **systemd** | 10/10 | Single-server, simple |
| **T2** | **Docker Compose** | 8/10 | Multi-server, simple |
| **T3** | **Kubernetes** | 9/10 | Enterprise standard |

### Monitoring

| Component | Choice | Score | Notes |
|-----------|--------|-------|-------|
| **Metrics** | **Prometheus** | 10/10 | Industry standard |
| **Visualization** | **Grafana** | 10/10 | Beautiful + Prometheus |
| **Logs** | **Loki** (T2), **Loki+ELK** (T3) | 9/10 | Lightweight + powerful |
| **Tracing** | **Jaeger** (T3 only) | 9/10 | Distributed tracing |

### CI/CD

| Platform | Choice | Score | Notes |
|----------|--------|-------|-------|
| **All Tiers** | **GitLab CI** | 10/10 | Already have, powerful |

---

## 💰 Cost Breakdown

### Tier 1 (Starter)

| Component | Cost |
|-----------|------|
| VM | $50-100/month |
| Software | Free (all open-source) |
| **TOTAL** | **$50-100** |

### Tier 2 (Professional)

| Component | Cost |
|-----------|------|
| 3x VMs (8 CPU, 16GB) | $450-900/month |
| PostgreSQL | $0 (self-hosted) |
| Vault | $0 (self-hosted) |
| Prometheus/Grafana/Loki | $0 (open-source) |
| **TOTAL** | **$450-900** |

### Tier 3 (Enterprise)

| Component | Cost |
|-----------|------|
| K8s Cluster | $1500-3000/month |
| PostgreSQL (managed) | $200-500/month |
| Everything else | $0 (open-source) |
| **TOTAL** | **$1700-3500** |

**Best cost/benefit**: Tier 2 (professional grade at reasonable cost)

---

## 📋 Comparison with Track 1 Findings

### How does this align with Track 1?

✅ **Git as source of truth**: Terraform + GitLab CI supports this
✅ **Decentralized agents**: Ansible is agentless (good for our IA-agent)
✅ **State-driven**: Terraform does this perfectly
✅ **Multi-cloud**: All choices support this
✅ **No vendor lock-in**: PostgreSQL, Vault, open-source tools

**Decisions reflect Track 1 best practices**

---

## 🚀 Migration Path (T1→T2)

### Database Migration: SQLite → PostgreSQL

```
Week 1: Preparation
  ├─ Set up PostgreSQL server
  ├─ Create schema (from SQLite)
  └─ Test connectivity

Week 2: Migration
  ├─ Dual-write phase (both DBs get new data)
  ├─ Validation (check data integrity)
  └─ Performance testing

Week 3: Switchover
  ├─ Switch app to PostgreSQL
  ├─ Monitor for 1 week
  └─ Keep SQLite as backup

Week 4: Cleanup
  └─ Remove SQLite

Downtime: 1-2 hours (during switchover)
Data loss risk: Minimal (with dual-write phase)
```

### IaC Migration: Ansible → Terraform + Ansible

```
Phase 1: Learn Terraform
  └─ Team learns Terraform syntax

Phase 2: Hybrid approach
  ├─ Use Terraform for infrastructure
  ├─ Keep Ansible for config
  └─ Parallel run (both systems)

Phase 3: Full migration
  └─ All infra via Terraform
```

---

## ✅ What's Done

✅ **10 components analyzed**:
1. Infrastructure as Code (Terraform, Ansible, Pulumi, CloudFormation)
2. Configuration Management (Ansible, Puppet, Chef)
3. Database (SQLite, PostgreSQL, MySQL, managed)
4. Secrets (File, Vault, AWS, GCP)
5. Orchestration (systemd, Docker Compose, K8s, Nomad)
6. Monitoring (Prometheus, ELK, Datadog, etc.)
7. CI/CD (GitLab CI, GitHub Actions, Jenkins)
8. Logs (Loki, ELK, others)
9. Tracing (Jaeger, others)
10. GitOps (ArgoCD, Flux)

✅ **Cost estimates** for each Tier
✅ **Migration paths** defined
✅ **Decision matrices** with scoring
✅ **Open questions** identified for PoC

---

## 📝 Open Questions

1. **SQLite performance**: What's the max concurrent connections?
2. **PostgreSQL HA**: How to set up replication for T2?
3. **Ansible speed**: Is serial execution acceptable for Tier 2?
4. **Vault setup**: Exact steps for HA Raft cluster?
5. **Docker registry**: Where to host container images (Quay, Harbor, ECR)?
6. **Helm charts**: How to create helm charts for our services?
7. **Monitoring retention**: How long to keep metrics/logs?
8. **Backup strategy**: How often to backup databases?

---

## 🔮 Recommendations for Next Steps

### Before PoC:
1. Get team feedback on tech choices
2. Identify knowledge gaps (Terraform, Vault, etc.)
3. Plan training/learning schedule

### PoC Timeline:
- **Tier 1 PoC**: 1-2 weeks
- **Tier 2 PoC**: 3-4 weeks (parallel with Tier 1)
- **Tier 3 PoC**: 4-6 weeks (after Tier 2)

### Success Criteria for PoC:
- ✅ Can deploy using automation (no manual steps)
- ✅ Can view metrics in Grafana
- ✅ Can rollback quickly
- ✅ Team is comfortable with tooling

---

**Track 2 Summary**: 2026-02-13
**Status**: ✅ **50% завершено** (выбор сделан, нужны PoC для валидации)
**Next**: Track 3 (Agent Architecture) + PoC validation

