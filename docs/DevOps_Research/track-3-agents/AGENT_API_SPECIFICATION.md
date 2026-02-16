# Track 3: Agent API Specification & Safety Framework

**Дата**: 2026-02-13

---

## 1. Agent API Specification

### 1.1 Base Endpoint

```
Tier 1: http://localhost:8001 (local agent)
Tier 2: https://agent.internal:8001 (internal VPC)
Tier 3: https://agent-<region>.internal:8001 (multi-region)
```

### 1.2 Core Endpoints

#### Health Check

```
GET /health

Response:
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "api_calls_made": 42,
  "last_error": null
}
```

#### Infrastructure State

```
GET /state

Response:
{
  "services": [
    {
      "name": "nginx",
      "status": "running",
      "health_score": 95,
      "metrics": {...}
    }
  ],
  "infrastructure": {
    "cpu_usage_percent": 42,
    "memory_usage_percent": 56,
    "disk_usage_percent": 73
  }
}
```

#### Execute Command

```
POST /commands/execute

Request:
{
  "command_id": "cmd_123",
  "action": "restart_service",
  "target": "nginx",
  "params": {
    "reason": "Health check failed"
  },
  "approval_token": "approval_456",
  "dry_run": true
}

Response:
{
  "status": "success",
  "execution_time_ms": 2500,
  "result": "Service restarted",
  "changes": [
    {
      "type": "service_restart",
      "service": "nginx",
      "old_status": "unhealthy",
      "new_status": "healthy"
    }
  ],
  "log_url": "/logs/cmd_123"
}
```

#### Trigger Approval

```
POST /approvals/request

Request:
{
  "action": "migrate_tier",
  "parameters": {
    "from_tier": 1,
    "to_tier": 2
  },
  "reason": "Tier 1 CPU consistently >80%",
  "estimated_impact": {
    "downtime_minutes": 2,
    "cost_increase_monthly": 400
  }
}

Response:
{
  "approval_id": "apr_789",
  "status": "pending",
  "expires_at": "2026-02-13T14:00:00Z",
  "notify_channels": ["slack", "email"],
  "approval_url": "https://ui.internal/approvals/apr_789"
}
```

#### Log Query

```
GET /logs?service=nginx&level=error&hours=24

Response:
{
  "logs": [
    {
      "timestamp": "2026-02-13T10:00:00Z",
      "level": "error",
      "message": "Connection timeout",
      "context": {
        "service": "nginx",
        "component": "upstream"
      }
    }
  ],
  "total_count": 42,
  "page": 1
}
```

---

## 2. Safety Framework

### 2.1 Command Classification

#### Level 0: Read-only (No approval needed)

```yaml
Commands:
  - get_service_status
  - get_metrics
  - get_logs
  - get_configuration
  - health_check

Timeout: 30 seconds
Rate limit: 100/minute
Cost: Minimal
```

#### Level 1: Low-risk changes (Auto-approve)

```yaml
Commands:
  - restart_service
  - scale_service (within limits)
  - rotate_logs
  - clear_cache
  - rebuild_cache

Conditions:
  - Must have recent health check
  - Must have rollback plan
  - Must not be during critical hours

Timeout: 5 minutes
Rate limit: 10/minute
Cost: Low
```

#### Level 2: Medium-risk changes (Human approval required)

```yaml
Commands:
  - deploy_update
  - update_configuration
  - scale_significantly (>50% change)
  - restart_database
  - modify_security_settings

Approval:
  - Human must approve
  - 30-minute timeout
  - Can override/reject

Timeout: 30 minutes
Rate limit: 5/hour
Cost: Medium
```

#### Level 3: High-risk changes (Escalation required)

```yaml
Commands:
  - migrate_to_tier
  - delete_data
  - modify_backups
  - change_db_password
  - major_version_upgrade

Approval:
  - Multiple people must approve
  - Executive review for cost impact
  - Can only proceed during maintenance window

Timeout: 2 hours
Rate limit: 1/day
Cost: High
```

### 2.2 Execution Constraints

```yaml
Rate Limiting:
  max_api_calls_per_minute: 100
  max_commands_per_hour: 50
  max_concurrent_commands: 5

Resource Limits:
  max_cpu_percent: 20%
  max_memory_mb: 512
  max_execution_time_seconds: 300

Costs:
  max_api_spend_per_day: $100
  alert_at_percent_of_budget: 80%
  stop_at_percent_of_budget: 100%

Timeout:
  level_0_timeout: 30s
  level_1_timeout: 5m
  level_2_timeout: 30m
  level_3_timeout: 2h
  hard_stop: 24h
```

### 2.3 Validation Before Execution

**Step 1: Syntax validation**
```
Is command well-formed?
├─ Valid JSON? ✓
├─ Required fields present? ✓
└─ Parameters type-correct? ✓
```

**Step 2: Permission check**
```
Is agent allowed to do this?
├─ Role has capability? ✓
├─ Target resource exists? ✓
└─ No security restrictions? ✓
```

**Step 3: Impact analysis**
```
What will change?
├─ Affected services? nginx, redis
├─ Estimated downtime? 30 seconds
├─ Data impact? None
└─ Cost impact? $0
```

**Step 4: Approval check**
```
Does this need approval?
├─ Level 0: No
├─ Level 1: Check conditions
├─ Level 2: Wait for human
└─ Level 3: Escalate
```

**Step 5: Pre-execution test**
```
Can we simulate this safely?
├─ Dry-run success? ✓
├─ No unexpected side-effects? ✓
└─ Rollback plan ready? ✓
```

---

## 3. Audit & Logging

### 3.1 Immutable Audit Log

```yaml
Entry:
  timestamp: "2026-02-13T10:05:00Z"
  command_id: "cmd_123"
  agent_id: "agent_1"
  user_id: "human_authorized_by"
  action: "restart_service"
  target: "nginx"
  status: "success"
  duration_ms: 2500
  approval:
    required: false
    granted: true
    granted_by: "system"
    granted_at: "2026-02-13T10:05:00Z"
  changes:
    - service: "nginx"
      old_state: "unhealthy"
      new_state: "healthy"
  cost_impact: "$0.00"
  error: null

Immutability:
  ✓ Signed with server key
  ✓ Cannot be modified or deleted
  ✓ Can be exported to external system
  ✓ Encrypted in transit & at rest
```

### 3.2 Log Retention

```
Logs kept for:
  Level 0 (read-only): 30 days
  Level 1 (low-risk): 90 days
  Level 2 (medium-risk): 365 days
  Level 3 (high-risk): 7 years

Searchable by:
  - Timestamp range
  - Command type
  - Service name
  - Status (success/failure)
  - User ID
  - Cost range

Export formats:
  - JSON
  - CSV
  - Splunk
  - CloudWatch
```

---

## 4. Error Handling & Recovery

### 4.1 Automatic Rollback

```
Action executed → Monitor health (30 seconds)
  ├─ If healthy: Commit (write to log)
  ├─ If error: AUTOMATIC ROLLBACK
  │  ├─ Reverse changes
  │  ├─ Restore previous state
  │  ├─ Alert human
  │  └─ Log the failure
  └─ If timeout: FORCE ROLLBACK
     └─ Same as error path
```

### 4.2 Recovery Time Objectives (RTO)

```
Level 1 failures:
  RTO: 30 seconds
  Method: Automatic rollback

Level 2 failures:
  RTO: 5 minutes
  Method: Automatic rollback + human verification

Level 3 failures:
  RTO: 1 hour
  Method: Manual recovery with ops team
```

---

## 5. Cost Control

### 5.1 LLM API Costs

```
Claude API pricing (approximate):
  Input: $0.003 / 1K tokens
  Output: $0.015 / 1K tokens

Typical agent operations:
  Health check: 100 tokens in, 50 out = $0.0009
  Analyze logs: 500 tokens in, 200 out = $0.0045
  Complex decision: 2000 tokens in, 500 out = $0.0135

Daily cost (estimate):
  100 health checks: $0.09
  20 log analyses: $0.09
  5 complex decisions: $0.07
  ─────────────────────────
  Daily total: ~$0.25 / month: ~$7.50
```

### 5.2 Cost Monitoring

```
Real-time dashboard:
  └─ Today's spend: $0.23 / $100 (0.23%)
  └─ This month: $7.10 / $3000 (0.24%)
  └─ Projected annual: $2,557 / $36,000 (7%)

Alerts:
  ⚠️ 80% of daily budget: Alert
  🛑 100% of daily budget: Stop new API calls
```

---

## 6. Multi-Tier Deployment

### Tier 1: Single Agent

```
Agent instance: 1
API endpoints: Local (8001)
Database: SQLite (embedded)
Knowledge: Embedded in prompt
Cost: Minimal API calls
```

### Tier 2: HA Agent

```
Agent instances: 2-3 (for redundancy)
Load balancer: Yes (nginx)
Database: PostgreSQL (external)
Knowledge: RAG from vector DB
Cost: Moderate API calls

HA Setup:
  ├─ Agent 1 (active)
  ├─ Agent 2 (standby)
  └─ Switch if Agent 1 fails
```

### Tier 3: Distributed

```
Agent instances: N (one per region)
Service mesh: Yes (Istio)
Database: PostgreSQL HA (multi-region)
Knowledge: Distributed RAG
Cost: High API calls

Regional agents:
  ├─ US agent (manages US infrastructure)
  ├─ EU agent (manages EU infrastructure)
  └─ Master agent (orchestrates)
```

---

## 7. LLM Model Selection

### Option 1: Claude 4 (Recommended)

```
Pros:
  ✅ Best reasoning capabilities
  ✅ Good context window (200K tokens)
  ✅ Safety-conscious
  ✅ Multi-turn conversation support
  ✅ Anthropic has safety focus

Cons:
  ❌ More expensive than GPT-4
  ❌ Inference latency (2-3 seconds)

Cost: ~$0.003/$0.015 per 1K tokens
```

### Option 2: GPT-4 Turbo

```
Pros:
  ✅ Fast inference
  ✅ Good reasoning
  ✅ Cheaper than Claude 4
  ✅ Large ecosystem

Cons:
  ❌ Less safety focus
  ❌ Smaller context window

Cost: ~$0.01/$0.03 per 1K tokens
```

### Option 3: Open Source (Llama 2, Mistral)

```
Pros:
  ✅ Run locally (no API calls)
  ✅ Zero API cost
  ✅ Full control

Cons:
  ❌ Weaker reasoning
  ❌ Requires compute to run
  ❌ More maintenance

Cost: Infrastructure cost (~$100/month GPU)
```

### **RECOMMENDATION**: Claude 4 + Optional fallback to GPT-4

- Claude 4 for main workload (best reasoning)
- GPT-4 as fallback (if Claude unavailable)
- Cost: ~$3000/year (very reasonable)

---

## 8. Testing & Validation

### 8.1 Unit Tests

```
Test cases:
  ✓ Agent can parse service state correctly
  ✓ Agent identifies unhealthy service
  ✓ Agent generates correct restart command
  ✓ Agent detects impossible commands
  ✓ Agent respects rate limits
```

### 8.2 Integration Tests

```
Test scenarios:
  ✓ End-to-end restart service (happy path)
  ✓ Rollback on failure
  ✓ Approval workflow
  ✓ Audit logging
  ✓ Rate limiting enforcement
```

### 8.3 Chaos Engineering (Tier 3 only)

```
Chaos scenarios:
  ✓ Kill random services → Agent recovers
  ✓ Network latency → Agent adjusts timeouts
  ✓ Agent API timeout → Fallback to manual
  ✓ Database failure → Agent alerts
  ✓ Disk full → Agent cleans up
```

---

**API Specification**: 2026-02-13
**Версия**: 1.0 (Draft)
