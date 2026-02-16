# Руководство по Tier'ам: От стартапа к корпорации

**Дата**: 2026-02-13
**Версия**: 1.0

---

## 🎯 Принцип: One System, Three Growth Stages

Единая система поддерживает три уровня сложности. Каждый уровень:
- ✅ Полностью функционален и production-ready
- ✅ Может быть развернут на имеющемся железе
- ✅ Имеет четкий путь миграции на следующий уровень
- ✅ Использует одинаковые компоненты (в разных конфигурациях)

---

## 📊 Сравнение Tier'ов

| Параметр | Tier 1 (Starter) | Tier 2 (Professional) | Tier 3 (Enterprise) |
|----------|------------------|----------------------|---------------------|
| **Целевой сценарий** | Стартап / PoC | Растущая компания | Крупная организация |
| **Размер железа** | 1 сервер: 6 CPU, 8 GB | 2-3 сервера: 8 CPU, 16 GB | K8s кластер (3+ nodes) |
| **Стоимость инфра** | ~$50-100/месяц | ~$500-2000/месяц | $2000+/месяц |
| **Database** | SQLite (embedded) | PostgreSQL (external) | K8s managed PostgreSQL |
| **Max projects** | ~50-100 | ~500 | Unlimited |
| **Max teams** | 1-5 | 5-50 | 50+ |
| **Downtime tolerance** | High (ok if goes down) | Medium (1-2h/year) | Low (99.99% SLA) |
| **HA/Redundancy** | None | Basic (manual failover) | Full (auto failover) |
| **Monitoring** | Basic logs | Prometheus + Grafana | Prometheus + Loki + Jaeger |
| **Scaling model** | Vertical only (upgrade VM) | Horizontal (add servers) | Auto-scaling (based on load) |
| **Multi-region** | No | No | Yes |
| **Compliance automation** | Basic | Good | Full (GDPR, SOC2, etc.) |

---

## 🔑 Когда выбрать каждый Tier

### Tier 1: Starter ⭐
**Идеален если**:
- Стартап или proof-of-concept
- Ограниченный бюджет
- < 50 проектов
- Нет критичных требований к HA/SLA
- Команда < 10 человек
- "Мне просто нужно что-то запустить быстро"

**Характеристики**:
```
✅ Быстрое развертывание (30 минут)
✅ Минимальные требования (дешевая ВМ)
✅ Простая управление (один сервер)
❌ Нет HA (single point of failure)
❌ Limited performance (SQLite bottleneck)
❌ No advanced features
```

**Миграция из**: Tier 1 → Tier 2 (когда выросли из Tier 1)

---

### Tier 2: Professional 🚀
**Идеален если**:
- Компания выросла из Tier 1
- 50-500 проектов
- Нужна лучшая observability
- Требуется basic HA для критических сервисов
- Команда 10-50 человек
- "Мы готовы к более серьезной инфраструктуре"

**Характеристики**:
```
✅ Хорошая производительность (PostgreSQL)
✅ Разделение ответственности (отдельные сервера)
✅ Лучший мониторинг (Prometheus)
✅ HA для критических сервисов
❌ Ручной failover (не полная автоматизация)
❌ Нет multi-region
```

**Миграция**:
- Из: Tier 1 → Tier 2 (плавная, ~2h с downtime или 0h без)
- В: Tier 2 → Tier 3 (по мере роста)

---

### Tier 3: Enterprise 💎
**Идеален если**:
- Большая организация
- 500+ проектов или unlimited
- Требуется 99.99% SLA
- Нужна multi-region deployment
- Требуются advanced security features
- Команда 50+ человек
- "Мы можем себе позволить K8s"

**Характеристики**:
```
✅ Полная автоматизация (auto-scaling, auto-failover)
✅ 99.99% uptime guarantee
✅ Multi-region deployment
✅ Advanced security (Vault, mTLS)
✅ Unlimited scaling
❌ Сложнее администрировать (K8s learning curve)
❌ Дороже
```

**Миграция из**: Tier 2 → Tier 3 (zero-downtime)

---

## 🔄 Процесс миграции между Tier'ами

### Миграция Tier 1 → Tier 2 (горизонтальное расширение)

```
День 1 (подготовка):
  ├─ Развернуть 2 новых сервера (8 CPU, 16 GB каждый)
  ├─ Установить PostgreSQL на отдельном сервере
  ├─ Настроить DNS API сервер
  └─ Настроить Prometheus + Grafana

День 2-3 (миграция данных):
  ├─ Backup текущего SQLite database
  ├─ Миграция БД в PostgreSQL (automated scripts)
  ├─ Dual-write фаза (новые операции в обеих БД)
  └─ Validation periode (1-2 дня)

День 4 (переключение):
  ├─ Переключить Management UI на PostgreSQL
  ├─ Переключить DNS на API server
  ├─ Switchover GitLab Runner
  └─ Shutdown Tier 1 сервер

Downtime: 30 минут до 2 часов (или можно zero-downtime с более сложной setup)
Risk: Low (есть rollback на Tier 1)
```

### Миграция Tier 2 → Tier 3 (Kubernetes)

```
День 1 (подготовка):
  ├─ Развернуть K8s кластер (3+ nodes)
  ├─ Настроить persistent volumes
  ├─ Настроить ingress controller
  └─ Создать Helm charts для каждого сервиса

День 2 (миграция):
  ├─ Миграция PostgreSQL (или use K8s managed DB)
  ├─ Миграция configurations
  ├─ Deploy services на K8s
  └─ Route traffic через K8s ingress

День 3 (validation):
  ├─ Smoke tests на K8s
  ├─ Load testing
  ├─ Decommission Tier 2 infrastructure (опционально)
  └─ Final validation

Downtime: Zero (blue-green deployment)
Risk: Medium (K8s complexity) → но есть quick rollback
```

---

## 📈 Когда переходить на следующий Tier?

### Рекомендирование от системы

Система будет отслеживать и рекомендовать миграцию когда:

```
Если (CPU usage > 80% OR
      RAM usage > 85% OR
      Projects > 80% of Tier limit OR
      API response time > SLA) И

    (состояние > 1 неделя)

THEN:
  ├─ Отправить notification: "Рекомендуем перейти на Tier N"
  ├─ Показать migration plan
  ├─ Подготовить cost estimation
  └─ Offer to schedule миграцию
```

### Метрики для мониторинга

**Tier 1 → Tier 2 переход нужен когда**:
- CPU usage постоянно > 75%
- RAM usage > 80%
- Projects > 100 (лимит Tier 1)
- Database queries медленные (> 1s)
- Response time API растет

**Tier 2 → Tier 3 переход нужен когда**:
- Projects > 500 (лимит Tier 2)
- Требуется multi-region
- Need for 99.99% SLA
- Advanced security требования (LDAP, Vault, etc.)

---

## 💾 Миграция данных: Гарантии

### Zero Data Loss Guarantee
1. **Backup перед каждым шагом**: полный backup текущего состояния
2. **Dual-write фаза**: новые операции идут в обе системы
3. **Validation checks**: проверка целостности после каждого шага
4. **Automated rollback**: < 30 минут до Tier 1 состояния если что-то не так

### Что автоматизируется
- ✅ Database schema migration
- ✅ Configuration migration
- ✅ Service health checks
- ✅ Data integrity validation
- ✅ Automated rollback

### Что требует человека
- ⚠️ Decision to migrate (риск assessment)
- ⚠️ Timing выбор (off-peak часы)
- ⚠️ Final approval перед switchover

---

## 🎓 Примеры сценариев

### Сценарий 1: Стартап растет

```
Месяц 1: Запустили на Tier 1 (1 VM, 6 CPU, 8 GB)
  └─ ~20 проектов, 5 человек в команде

Месяц 6: Выросли!
  ├─ ~150 проектов (переросли Tier 1)
  ├─ 20 человек в команде
  ├─ Нужна лучше observability
  └─ Рекомендуем: Tier 2

День X: Миграция на Tier 2
  ├─ 2-3 часа downtime
  ├─ Все данные сохранены
  ├─ Лучшая производительность
  └─ Готовы к дальнейшему росту

Месяц 18: Очень большие!
  ├─ ~1000 проектов
  ├─ Требуется 99.99% SLA
  ├─ Multi-team, разные регионы
  └─ Рекомендуем: Tier 3 (K8s)

День Y: Миграция на Tier 3
  ├─ Zero downtime
  ├─ Auto-scaling готов
  ├─ Multi-region ready
  └─ Enterprise-grade инфра
```

### Сценарий 2: Корпоративный переход

```
Текущее состояние: Old legacy infra
  ├─ Non-standardized setup
  ├─ Разные версии сервисов
  └─ Плохой мониторинг

Фаза 1: Развернуть Tier 3 (K8s)
  ├─ Новый K8s кластер рядом со старой инфра
  ├─ Миграция сервисов one-by-one
  └─ Parallel run (old + new)

Фаза 2: Blue-Green switch
  ├─ Все traffic на новый K8s
  ├─ Old infra в standby
  └─ Zero downtime

Результат: Modern, scalable, compliant infrastructure
```

---

## 🛠️ Инструменты для миграции

**Что система предоставляет**:

```
docs/migration/
├── tier1-to-tier2/
│   ├── migration-plan.md
│   ├── scripts/
│   │   ├── prepare-tier2.sh
│   │   ├── migrate-sqlite-to-postgres.sh
│   │   ├── validate-data-integrity.sh
│   │   └── switchover.sh
│   └── rollback-tier1.sh
│
├── tier2-to-tier3/
│   ├── migration-plan.md
│   ├── helm-charts/
│   │   ├── management-ui/
│   │   ├── gitlab-runner/
│   │   └── ...
│   ├── scripts/
│   │   ├── create-k8s-cluster.sh
│   │   ├── deploy-services.sh
│   │   ├── validate-k8s.sh
│   │   └── switchover-zero-downtime.sh
│   └── rollback-tier2.sh
│
└── common/
    ├── backup-and-restore.sh
    ├── health-checks.sh
    └── monitoring-validation.sh
```

---

## ❓ Часто задаваемые вопросы

**Q: Могу ли я начать с Tier 2 вместо Tier 1?**
A: Да, но это перерасходование ресурсов. Tier 1 дешевле и проще для стартапов.

**Q: Как долго миграция Tier 1 → Tier 2?**
A: Подготовка: 4-8 часов, миграция данных: 1-2 дня, switchover: 30 минут до 2 часов

**Q: Что произойдет если миграция сломается?**
A: Автоматический rollback на Tier 1 (< 30 минут), все данные безопасны

**Q: Нужно ли переучивать команду при переходе на Tier 2?**
A: Нет, Management UI остается тем же, внутренние изменения прозрачны

**Q: Могу ли я "перепрыгнуть" с Tier 1 на Tier 3 (пропустить Tier 2)?**
A: Технически да, но Tier 2 — лучший промежуточный шаг. Прямой переход сложнее.

**Q: Как агент знает, когда нужна миграция?**
A: Агент отслеживает метрики 24/7 и рекомендует миграцию при нарушении порогов

**Q: Будет ли downtime при использовании автоматической миграции?**
A: Tier 1→2: 30 мин до 2 часов (или 0 если сложная конфигурация)
  Tier 2→3: 0 часов (zero-downtime переключение)

---

## 📞 Дополнительные ресурсы

- **TZ_DEVOPS_AI_SYSTEM.md**: Полные требования про Tier'ы
- **RESEARCH_PLAN.md**: Что нужно исследовать про архитектуру
- **README.md**: Общий overview проекта

---

**Документ создан**: 2026-02-13
**Версия**: 1.0
**Статус**: Ready for research teams
