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

  // SSE real-time updates (only when monitoring + SSE enabled)
  useMonitoringSSE(!!config?.enabled && !!config?.sse?.enabled);
  const { data: status, isLoading: statusLoading } = useMonitoringStatus();
  const { data: alertsData, isLoading: alertsLoading } = useAlerts({ status: 'active' });

  const updateConfig = useUpdateMonitoringConfig();
  const runAllChecks = useRunAllChecks();
  const runCheck = useRunCheck();
  const ackAlert = useAckAlert();
  const resolveAlert = useResolveAlert();

  const services = status?.services ?? {};
  const alerts = alertsData?.alerts ?? [];
  const serviceCount = Object.keys(services).length;
  const upCount = Object.values(services).filter((s) => s.status === 'up').length;

  const handleEnable = () => {
    updateConfig.mutate(
      { enabled: true } as any,
      { onSuccess: () => toast.success('Мониторинг включён') },
    );
  };

  // Disabled state
  if (!configLoading && config && !config.enabled) {
    return (
      <>
        <PageHeader title="Мониторинг" description="Система мониторинга отключена" />
        <EmptyState
          icon={Activity}
          title="Мониторинг отключён"
          description="Включите мониторинг для отслеживания состояния сервисов"
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
        description="Состояние сервисов и алерты"
        actions={
          <div className="flex gap-2">
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
          </div>
        }
      />

      {/* Stats */}
      <DashboardGrid>
        <StatCard label="Сервисов" value={serviceCount} icon={Server} />
        <StatCard
          label="Работает"
          value={upCount}
          icon={Activity}
          variant={upCount === serviceCount ? 'success' : 'warning'}
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

      {/* Service Status Grid */}
      <div className="mb-6">
        <h3 className="text-sm font-medium mb-3">Статус сервисов</h3>
        <ServiceStatusGrid
          services={services}
          onCheckService={(name) =>
            runCheck.mutate(name, {
              onSuccess: () => toast.success(`Проверка ${name} завершена`),
            })
          }
          loading={statusLoading}
        />
      </div>

      {/* Active Alerts */}
      <div>
        <h3 className="text-sm font-medium mb-3">Активные алерты</h3>
        <AlertsList
          alerts={alerts}
          onAck={(id) =>
            ackAlert.mutate(id, {
              onSuccess: () => toast.success('Алерт подтверждён'),
            })
          }
          onResolve={(id) =>
            resolveAlert.mutate(id, {
              onSuccess: () => toast.success('Алерт закрыт'),
            })
          }
          loading={alertsLoading}
        />
      </div>
    </>
  );
}
