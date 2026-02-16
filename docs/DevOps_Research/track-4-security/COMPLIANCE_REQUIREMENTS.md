# Track 4: Compliance Requirements & Implementation

**Дата**: 2026-02-13
**Статус**: Compliance framework for each tier

---

## 1. Global Privacy & Data Protection

### 1.1 GDPR (General Data Protection Regulation)

**Applies to**: Any data of EU residents (regardless of where your company is)

#### Key Principles

```yaml
1. Lawfulness, Fairness, Transparency
   - Have legal basis for processing
   - Be transparent about data use
   - Don't use data deceptively

2. Purpose Limitation
   - Collect for specified purposes
   - Don't repurpose without consent
   - Delete when no longer needed

3. Data Minimization
   - Only collect necessary data
   - Don't collect "just in case"
   - Example: Don't collect full credit card numbers if you don't process payments

4. Accuracy
   - Keep data accurate and up-to-date
   - Allow users to correct their data

5. Storage Limitation
   - Define retention periods
   - Delete after retention expires
   - Automate deletion (no manual process)

6. Integrity & Confidentiality
   - Encrypt sensitive data
   - Prevent unauthorized access
   - Implement access controls

7. Accountability
   - Document compliance efforts
   - Maintain audit trail
   - Be prepared for data protection authority inquiries
```

#### User Rights (GDPR Articles 15-22)

```yaml
Right to Access:
  - User can request: "Give me all data you have about me"
  - You must provide: Downloadable export (machine-readable format)
  - Timeframe: 30 days
  - Cost: Free
  - Implementation: Export API (GET /api/user/{id}/export)

Right to Rectification:
  - User can correct wrong data
  - Implementation: Edit form for profile data
  - Document changes (audit trail)

Right to Erasure:
  - "Right to be forgotten"
  - User can request: Delete all personal data
  - Exception: Legal obligations (taxes, security logs)
  - Timeframe: 30 days
  - Implementation: DELETE /api/user/{id} (soft delete, audit trail kept)

Right to Restrict Processing:
  - User can say: "Don't use my data, just keep it"
  - Implementation: Mark user as "restricted" (read-only)
  - Timeframe: 30 days

Right to Data Portability:
  - User can say: "Export my data in standard format"
  - Format: JSON, CSV (machine-readable)
  - Timeframe: 30 days
  - Implementation: Same as Right to Access

Right to Object:
  - User can opt-out of processing
  - Implementation: Privacy preferences page
  - Timeframe: Immediate

Right to Not Be Subject to Automated Decision-Making:
  - User has right to human review if automated decision affects them
  - Relevant for: Agent operations that affect user
  - Mitigation: Always require human approval for critical ops
```

#### Data Processing Agreement (DPA)

**Required if**: You store/process EU resident data

```yaml
Must include:
  - Subject matter of processing
  - Duration of processing
  - Nature & purpose of processing
  - Type of data
  - Categories of data subjects
  - Responsibilities of parties

Implementation:
  - Document in compliance.md
  - Get customer consent
  - Sign DPA before processing starts
  - Review annually
```

#### Data Protection Impact Assessment (DPIA)

**Required if**: High-risk processing

```yaml
High-risk processing examples:
  - Collecting sensitive data (health, financial, biometric)
  - Large-scale processing
  - Automated decision-making
  - Profiling

DPIA process:
  1. Describe processing (what data, who accesses, where stored)
  2. Assess necessity & proportionality
  3. Evaluate risks to data subjects
  4. Identify safeguards
  5. Document and review

Required for:
  - Tier 3 (enterprise, possibly high-risk)
  - Tier 2 (if processing sensitive data)
  - Tier 1 (only if required by laws)
```

#### Implementation by Tier

```yaml
Tier 1 (Basic GDPR Compliance):
  ✅ Privacy Policy (on website)
  ✅ Consent management (cookie banner)
  ✅ Data retention policy (stated)
  ✅ User export functionality
  ✅ Audit trail for all access
  ✅ Encryption of sensitive data
  ❌ Not required: DPA, DPIA (unless required by customer)

Tier 2 (Full GDPR Compliance):
  ✅ Everything from T1
  ✅ Data Processing Agreement (DPA)
  ✅ Data deletion API (Right to Erasure)
  ✅ Data portability export
  ✅ Privacy settings UI
  ✅ DPIA for high-risk processing
  ✅ Data Protection Officer (if needed)

Tier 3 (Advanced GDPR Compliance):
  ✅ Everything from T2
  ✅ Automated DPIA tool
  ✅ Real-time data subject rights fulfillment
  ✅ Consent management platform
  ✅ Privacy by design in all systems
  ✅ Regular DPA reviews
```

---

### 1.2 CCPA (California Consumer Privacy Act)

**Applies to**: Californian residents' data (if you do business in California)

#### Key Rights

```yaml
Right to Know:
  - What personal information is collected
  - How it's used
  - How it's shared
  - Implementation: Privacy policy + transparency page

Right to Delete:
  - User can request deletion
  - Similar to GDPR Right to Erasure
  - Exceptions: Legal obligations, security
  - Timeframe: 45 days

Right to Opt-Out:
  - User can opt-out of "sale" or "sharing"
  - "Sale": Exchange for money/valuable consideration
  - "Sharing": Use for cross-context targeted advertising
  - Implementation: "Do Not Sell" link on homepage

Right to Non-Discrimination:
  - Can't penalize user for exercising rights
  - Can't refuse service for opting out
  - Can't charge more
```

#### Implementation

```yaml
Tier 1/2/3 (CCPA Compliance):
  ✅ Privacy policy mentioning CCPA rights
  ✅ "Do Not Sell My Information" link (if applicable)
  ✅ Data export API
  ✅ Data deletion API
  ✅ Consumer request process
  ✅ Verification mechanism (prevent impersonation)
  ✅ Respond within 45 days

Differences from GDPR:
  ❌ No consent requirement (CCPA is opt-out based)
  ❌ No DPA required
  ✅ Narrower definition of "personal information"
```

---

## 2. Industry-Specific Compliance

### 2.1 HIPAA (Health Insurance Portability & Accountability Act)

**Applies to**: Healthcare providers, health plans, health clearinghouses

#### Key Requirements

```yaml
NOT suitable for Tier 1.
Consider only if processing medical data.

Tier 2 HIPAA-Ready:
  - ✅ Encryption (data at rest & in transit)
  - ✅ Access controls (role-based)
  - ✅ Audit logging (all access)
  - ✅ Data integrity controls
  - ✅ Backup & recovery
  - ⚠️ Business Associate Agreements (BAA)

Tier 3 HIPAA-Compliant:
  - ✅ Everything from T2
  - ✅ Formal HIPAA compliance program
  - ✅ Security Risk Assessment
  - ✅ Incident response plan
  - ✅ Regular penetration testing
  - ✅ Workforce training (annual)
  - ✅ External HIPAA audit

Effort:
  T2: 3-4 weeks
  T3: 2-3 months + ongoing (certified)
```

### 2.2 PCI DSS (Payment Card Industry Data Security Standard)

**Applies to**: If handling credit card data

#### Key Requirements

```yaml
Tier 1: NOT suitable for credit card processing

Tier 2/3 (PCI DSS v3.2.1):
  ✅ Firewall configuration
  ✅ Strong access controls (MFA)
  ✅ Data protection (encryption)
  ✅ Vulnerability scanning (quarterly)
  ✅ Access control & authentication (annual)
  ✅ Regular testing & monitoring

Recommendation:
  - Don't process credit cards yourself
  - Use payment processor (Stripe, Square)
  - They handle PCI compliance
  - You store only: tokenized cards (not real data)
  - Your effort: Minimal

If you must process:
  Effort: High ($50k+ annually for compliance)
  Timeline: 3-4 months
  Certification: Annual audit required
```

---

## 3. Enterprise Compliance Standards

### 3.1 SOC 2 (Service Organization Control)

**Applies to**: Service providers handling customer data

#### What is SOC 2?

```
SOC 2 Type I:
  - Assessment of security controls at a point in time
  - Duration: One day audit
  - Cost: $5k - 10k
  - Validity: Snapshot (not ongoing)
  - Who cares: Customers (due diligence)

SOC 2 Type II (Recommended):
  - Assessment of security controls over time
  - Duration: 6-12 months observation
  - Cost: $10k - 20k
  - Validity: 1 year
  - Who cares: Enterprise customers (contracts require it)
```

#### 5 Trust Service Criteria

```yaml
1. Security (CC): Protect against unauthorized access
   Implementation:
     - ✅ Authentication (MFA)
     - ✅ Authorization (RBAC)
     - ✅ Encryption
     - ✅ Audit logging
     - ✅ Access monitoring

2. Availability (A): Systems are available & operational
   Implementation:
     - ✅ Uptime monitoring
     - ✅ Backup & recovery
     - ✅ Disaster recovery plan
     - ✅ RTO/RPO targets
     - ✅ Regular DR testing

3. Processing Integrity (PI): Transactions are complete, accurate, timely
   Implementation:
     - ✅ Input validation
     - ✅ Error handling
     - ✅ Transaction logging
     - ✅ Reconciliation
     - ✅ Data quality checks

4. Confidentiality (C): Confidential information is protected
   Implementation:
     - ✅ Data classification
     - ✅ Encryption of sensitive data
     - ✅ Access controls
     - ✅ NDA contracts
     - ✅ Data minimization

5. Privacy (P): Personal information is handled per policy
   Implementation:
     - ✅ Privacy policy
     - ✅ Consent management
     - ✅ Data retention policy
     - ✅ User rights (access, delete)
     - ✅ Data processing agreement
```

#### SOC 2 Implementation Timeline

```yaml
Phase 1: Preparation (Month 1)
  - Appoint compliance officer
  - Audit current controls
  - Document policies
  - Identify gaps

Phase 2: Implementation (Month 2-3)
  - Implement missing controls
  - Document procedures
  - Train staff
  - Collect evidence

Phase 3: Observation (Month 4-9)
  - Run controls for 6 months minimum
  - Collect evidence of operation
  - Regular testing
  - Fix issues as they arise

Phase 4: Audit (Month 10-12)
  - External auditor review
  - Interview staff
  - Verify controls
  - Issue SOC 2 Report Type II

Cost:
  Tier 2: Achievable ($15k-25k total)
  Tier 3: Expected ($20k-40k total)
```

### 3.2 ISO 27001 (Information Security Management System)

**Applies to**: Organizations wanting enterprise certification

#### Scope

```
More comprehensive than SOC 2.
Covers all 14 security domains:
  1. Organization of information security
  2. Mobile device & teleworking
  3. Asset management
  4. Access control
  5. Cryptography
  6. Physical & environment security
  7. Operations security
  8. Communications security
  9. System acquisition, development & maintenance
  10. Supplier relationships
  11. Information security incident management
  12. Business continuity management
  13. Compliance (legal requirements)
  14. Risk management
```

#### Implementation Timeline

```yaml
Phase 1: Planning (Month 1-2)
  - Scope definition
  - Stakeholder mapping
  - Budget approval
  - Compliance officer assignment

Phase 2: Design (Month 3-4)
  - ISMS design
  - Risk assessment
  - Control selection
  - Documentation

Phase 3: Implementation (Month 5-12)
  - Control implementation
  - Process changes
  - Tool deployment
  - Staff training

Phase 4: Audit (Month 13-18)
  - Pre-audit assessment
  - Gap analysis
  - Final preparations
  - Certification audit

Cost:
  T2: Possible ($25k-50k)
  T3: Recommended ($30k-60k + annual audit)

Timeline:
  Start to certification: 12-18 months
```

---

## 4. Data Retention & Deletion Policy

### 4.1 Retention Schedule by Data Type

```yaml
User Account Data:
  Active user: Keep as long as account is active
  Deleted account: Soft delete (keep for 90 days), then permanent delete
  Audit trail: Keep for 7 years (legal requirement)

Operational Logs:
  Application logs: 30 days
  Audit logs: 365 days (T2) / 7 years (T3)
  API request logs: 90 days

Security Events:
  Authentication logs: 90 days
  Failed login attempts: 30 days
  Permission changes: 7 years
  Security incidents: 7 years

Business Data:
  Customer projects: Keep for duration of contract + 1 year
  Service configurations: Keep for duration of contract + 1 year
  Payment records: 7 years (accounting requirement)
  Contracts: 7 years after expiration

Backups:
  Daily backups: Keep 30 days
  Weekly backups: Keep 90 days
  Monthly backups: Keep 1 year
  Yearly backups: Keep 7 years
```

### 4.2 Deletion Implementation

```yaml
Tier 1 (Manual):
  Process:
    1. Query data older than retention period
    2. Export for archival (if needed)
    3. Delete from database
    4. Verify deletion
    5. Log deletion action

  Frequency: Monthly (cron job)
  Testing: Quarterly restore test

Tier 2 (Automated):
  Process:
    1. Define retention policy per data type
    2. Implement TTL fields in database
    3. Automated deletion job (weekly)
    4. Alerting if deletion fails
    5. Archive deleted data (encrypted) for 1 month

  Implementation: PostgreSQL + cron

Tier 3 (Policy-Driven):
  Process:
    1. Policy-as-code (yaml defining retention)
    2. Automated enforcement
    3. Real-time deletion (via scheduler)
    4. Compliance verification
    5. Audit trail of all deletions

  Implementation: Kubernetes + CronJob + policy engine
```

---

## 5. Breach Notification Requirements

### 5.1 What Constitutes a Breach?

```yaml
Confirmed breach:
  - Unauthorized access to personal data
  - Unauthorized disclosure
  - Loss of data (theft, accidental deletion)
  - Encryption key compromised

Not a breach:
  - Authorized access
  - Unauthorized access attempt (but no data accessed)
  - Anonymized data (can't identify individuals)
  - Aggregated data (no personal information)
```

### 5.2 Notification Timeline

```yaml
GDPR (EU residents):
  Timeline: Notify within 72 hours of discovery
  To: Data Protection Authority (required)
  To: Data subjects (if high risk)
  Content: What happened, what data, what we're doing, contact

CCPA (California):
  Timeline: Without unreasonable delay
  To: California Attorney General (if > 500 residents affected)
  To: Consumers (via email, phone, mail)
  Content: What happened, what data, what to do

Others:
  - Check local laws (vary by country/state)
  - Most require notification within 30-60 days
  - Have template breach notification ready
```

### 5.3 Breach Response Plan

```yaml
Immediate (First hour):
  1. Confirm breach is real (get evidence)
  2. Notify leadership / legal team
  3. Begin containment (stop attacker if possible)
  4. Secure evidence (don't modify)
  5. Open incident ticket

Investigation (Day 1):
  1. Determine scope: What data? How much?
  2. Determine timeline: When did it start? When discovered?
  3. Determine cause: How did attacker get in?
  4. Determine impact: Who was affected? Is it ongoing?
  5. Contact forensics/security firm (if needed)

Notification (Day 3):
  1. Draft notification message (with legal review)
  2. Notify authorities (if required)
  3. Notify affected users (email + phone)
  4. Set up hotline (for questions)
  5. Monitor for secondary incidents

Remediation (Week 1):
  1. Fix the vulnerability
  2. Rotate all compromised credentials
  3. Implement additional monitoring
  4. Update security controls
  5. Communication with users

Post-Incident (Month 1):
  1. Complete investigation
  2. Write incident report
  3. Implement improvements
  4. Brief leadership / board
  5. Check credit monitoring services (if data breach)
```

---

## 6. Compliance by Tier

### Tier 1 Compliance Checklist

```yaml
✅ Privacy & Data Protection:
  - [ ] Privacy policy (on website)
  - [ ] Cookie consent banner
  - [ ] Email marketing opt-out
  - [ ] GDPR notice (if EU users)
  - [ ] CCPA notice (if CA users)

✅ Data Handling:
  - [ ] Data retention policy (documented)
  - [ ] Secure deletion process
  - [ ] Encryption for sensitive data
  - [ ] Audit trail for sensitive access

✅ Incident Response:
  - [ ] Breach notification template
  - [ ] Contact info for key people
  - [ ] Backup/recovery procedure
  - [ ] Recovery RTO: < 4 hours

✅ Documentation:
  - [ ] Privacy policy
  - [ ] Data retention policy
  - [ ] Incident response plan
  - [ ] Change log (versioned)

Estimated effort: 1-2 weeks
Cost: Minimal (documentation + process)
Certification: None required
```

### Tier 2 Compliance Checklist

```yaml
✅ Everything from Tier 1 +

✅ Privacy & Data Protection:
  - [ ] GDPR Data Protection Impact Assessment (DPIA)
  - [ ] Data Processing Agreement (DPA) template
  - [ ] Consent management system
  - [ ] User data export API (GDPR Right to Access)
  - [ ] User data deletion API (GDPR Right to Erasure)
  - [ ] Data portability export

✅ Security:
  - [ ] Vulnerability scanning (quarterly)
  - [ ] Penetration testing (annual)
  - [ ] Code security review (annual)
  - [ ] Dependency scanning (continuous)

✅ Compliance:
  - [ ] SOC 2 controls implemented
  - [ ] SOC 2 audit timeline set (6-12 months)
  - [ ] Risk assessment completed
  - [ ] Compliance officer assigned

✅ Incident Response:
  - [ ] Incident response team identified
  - [ ] Playbooks for common scenarios
  - [ ] Regular drills / testing
  - [ ] Recovery RTO: < 1 hour

Estimated effort: 6-8 weeks (spread over 6 months)
Cost: $15k-25k (SOC 2 audit)
Certification: SOC 2 Type II (achievable)
Timeline: 6-12 months to SOC 2
```

### Tier 3 Compliance Checklist

```yaml
✅ Everything from Tier 2 +

✅ Advanced Privacy:
  - [ ] ISO 27001 compliance planned
  - [ ] Advanced DPIA (automated tool)
  - [ ] Consent management platform
  - [ ] Real-time user rights fulfillment
  - [ ] Privacy by design in all systems

✅ Advanced Security:
  - [ ] Penetration testing (2x per year)
  - [ ] Red team exercises (annual)
  - [ ] Third-party security assessments
  - [ ] Bug bounty program
  - [ ] Security code review (all changes)

✅ Compliance:
  - [ ] SOC 2 Type II certified
  - [ ] ISO 27001 certification (in progress or completed)
  - [ ] HIPAA compliance (if applicable)
  - [ ] PCI DSS compliance (if applicable)
  - [ ] Industry-specific certifications

✅ Incident Response:
  - [ ] Dedicated security team
  - [ ] 24/7 incident response
  - [ ] Incident response retainer (external firm)
  - [ ] Regular tabletop exercises
  - [ ] Recovery RTO: < 15 minutes

Estimated effort: 2-3 months (initial) + ongoing
Cost: $50k-100k+ (certifications + audits)
Certification: SOC 2 Type II + ISO 27001 + others
Timeline: 12-18 months to ISO 27001
```

---

## 7. Compliance Tools & Automation

### Tool Stack by Tier

```yaml
Tier 1:
  Privacy: Cookie compliance tool (simple)
  Security: SAST tool (free tier)
  Dependency scanning: npm audit (built-in)
  Monitoring: CloudWatch logs
  Cost: < $500/month

Tier 2:
  Privacy: Consent management platform ($2k-5k/month)
  Security: SAST + DAST tools ($5k-10k/month)
  Vulnerability scanning: Snyk, WhiteSource ($3k-8k/month)
  Secrets scanning: TruffleHog, git-secrets (free)
  SIEM: Loki + Grafana (free)
  Cost: $15k-30k/month

Tier 3:
  Privacy: Advanced consent platform + DPIA tool ($5k-10k/month)
  Security: Enterprise SAST/DAST ($20k-50k/month)
  Vulnerability scanning: Rapid7, Qualys ($10k-30k/month)
  SIEM: Splunk, Datadog ($20k-50k/month)
  Threat modeling: Automated tools ($5k-10k/month)
  Compliance: Compliance automation platform ($5k-15k/month)
  Cost: $70k-200k+/month
```

---

## 8. Recommended Compliance Roadmap

### Year 1: Foundation (Tier 1 → Tier 2)

```
Q1:
  - ✅ Privacy policy & GDPR notices
  - ✅ Data retention policy
  - ✅ Encryption at rest + in transit
  - ✅ Basic audit logging

Q2:
  - ✅ SAST scanning (CI/CD)
  - ✅ Dependency scanning
  - ✅ Access logging & alerting
  - ✅ Incident response plan

Q3:
  - ✅ SOC 2 controls implementation
  - ✅ Security audit preparation
  - ✅ DPA template creation
  - ✅ Vulnerability scanning

Q4:
  - ✅ First SOC 2 audit (Type I)
  - ✅ Continue observation for Type II
  - ✅ Penetration testing
  - ✅ Security training (team)

Cost: $20k-30k
```

### Year 2-3: Hardening (Tier 2 → Tier 3)

```
Year 2:
  - ✅ SOC 2 Type II certification (complete)
  - ✅ ISO 27001 assessment
  - ✅ Advanced DPIA process
  - ✅ HIPAA/PCI (if needed)
  - ✅ Red team exercise

Year 3:
  - ✅ ISO 27001 certification (complete)
  - ✅ Maintain SOC 2 & ISO 27001
  - ✅ Advanced threat modeling
  - ✅ Compliance automation

Cost: $50k-100k/year
```

---

**Document created**: 2026-02-13
**Version**: 1.0 (Draft)
**Status**: Compliance requirements mapped to tiers

