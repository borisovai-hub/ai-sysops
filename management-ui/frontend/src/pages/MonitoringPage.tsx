import { toast } from 'sonner';
import { Activity, Server, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ServiceStatusGrid } from '@/components/monitoring/ServiceStatusGrid';
import { AlertsList } from '@/components/monitoring/AlertsList';
import {
  useMonitoringConfig,
  useMonitoringStatus,
  useAlerts,
} from '@/api/queries/monitoring';
import {
  useUpdateMonitoringConfig,
  useRunAllChecks,
  useRunCheck,
  useAckAlert,
  useResolveAlert,
} from '@/api/mutations/monitoring';
import { useMonitoringSSE } from '@/lib/useMonitoringSSE';

export function MonitoringPage() {
  const { data: config, isLoading: configLoading } = useMonitoringConfig();

  useMonitoringSSE(!!config?.enabled && !!config?.sse?.enabled);
  const { data: status, isLoading: statusLoading } = useMonitoringStatus();
  const { data: alertsData, isLoading: alertsLoading } = useAlerts({ status: 'active' });

  const updateConfig = useUpdateMonitoringConfig();
  const runAllChecks = useRunAllChecks();
  const runCheck = useRunCheck();
  const ackAlert = useAckAlert();
  const resolveAlert = useResolveAlert();

  const servers = status?.servers ?? {};
  const alerts = alertsData?.alerts ?? [];

  // Aggregate stats across all servers
  const allChecks = Object.values(servers).flatMap((svcs) => Object.values(svcs));
  const serverCount = Object.keys(servers).length;
  const serviceCount = allChecks.length;
  const upCount = allChecks.filter((s) => s.status === 'up').length;

  const handleEnable = () => {
    updateConfig.mutate(
      { enabled: true } as never,
      { onSuccess: () => toast.success('Мониторинг включён') },
    );
  };

  if (!configLoading && config && !config.enabled) {
    return (
      <>
        <PageHeader title="Мониторинг" description="Система мониторинга отключена" />
        <EmptyState
          icon={Activity}
          title="Мониторинг отключён"
          description="Включите мониторинг для отслеживания состояния сервисов всей инфраструктуры"
          action={
            <Button onClick={handleEnable} disabled={updateConfig.isPending}>
              <Activity className="h-4 w-4" />
              Включить мониторинг
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Мониторинг"
        description={
          serverCount > 0
            ? `${serverCount} сервер${serverCount === 1 ? '' : 'а'} · ${serviceCount} проверок`
            : 'Состояние сервисов и алерты'
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              runAllChecks.mutate(undefined, {
                onSuccess: () => toast.success('Проверка запущена'),
              })
            }
            disabled={runAllChecks.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${runAllChecks.isPending ? 'animate-spin' : ''}`} />
            {runAllChecks.isPending ? 'Проверка...' : 'Обновить'}
          </Button>
        }
      />

      <DashboardGrid>
        <StatCard label="Серверов" value={serverCount} icon={Server} />
        <StatCard
          label="Работает"
          value={`${upCount}/${serviceCount}`}
          icon={Activity}
          variant={upCount === serviceCount && serviceCount > 0 ? 'success' : 'warning'}
        />
        <StatCard
          label="Алертов"
          value={alerts.length}
          icon={AlertTriangle}
          variant={alerts.length > 0 ? 'destructive' : 'default'}
        />
        <StatCard
          label="Аптайм 24ч"
          value={status?.overallUptime != null ? `${status.overallUptime.toFixed(1)}%` : '—'}
          icon={Clock}
          variant={
            status?.overallUptime != null
              ? status.overallUptime >= 99
                ? 'success'
                : status.overallUptime >= 95
                  ? 'warning'
                  : 'destructive'
              : 'default'
          }
        />
      </DashboardGrid>

      {/* Per-server sections */}
      {Object.entries(servers).length === 0 && !statusLoading && (
        <EmptyState
          icon={Server}
          title="Нет данных"
          description="Реестр серверов пуст или агенты ещё не отчитались. Зайдите на страницу «Серверы» для добавления."
        />
      )}

      {Object.entries(servers).map(([serverName, services]) => {
        const total = Object.keys(services).length;
        const upCnt = Object.values(services).filter((s) => s.status === 'up').length;
        const allUp = upCnt === total && total > 0;
        return (
          <div key={serverName} className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Server className="h-4 w-4" />
                {serverName}
                <span className={`text-xs ${allUp ? 'text-green-600' : 'text-amber-600'}`}>
                  ({upCnt}/{total})
                </span>
              </h3>
            </div>
            <ServiceStatusGrid
              services={services}
              onCheckService={(name) =>
                runCheck.mutate(
                  { server: serverName, service: name },
                  { onSuccess: () => toast.success(`Проверка ${serverName}/${name} завершена`) },
                )
              }
              loading={statusLoading}
            />
          </div>
        );
      })}

      <div>
        <h3 className="text-sm font-medium mb-3">Активные алерты</h3>
        <AlertsList
          alerts={alerts}
          onAck={(id) =>
            ackAlert.mutate(id, { onSuccess: () => toast.success('Алерт подтверждён') })
          }
          onResolve={(id) =>
            resolveAlert.mutate(id, { onSuccess: () => toast.success('Алерт закрыт') })
          }
          loading={alertsLoading}
        />
      </div>
    </>
  );
}
