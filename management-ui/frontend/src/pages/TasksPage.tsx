import { CheckSquare, ExternalLink, Shield, Mail, Calendar, Server } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status/StatusBadge';
import { useTasksStatus } from '@/api/queries/tasks';

export function TasksPage() {
  const { data: status, isLoading } = useTasksStatus();

  const isRunning = status?.status === 'running';
  const cfg = status?.config;
  const urls = status?.domains?.map((d) => `https://${d}`) ?? [];

  return (
    <>
      <PageHeader
        title="Задачи"
        description="Vikunja -- планировщик задач с календарём"
        actions={
          urls[0] ? (
            <a href={urls[0]} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink className="h-4 w-4" /> Открыть Vikunja
              </Button>
            </a>
          ) : null
        }
      />

      {isLoading ? (
        <DashboardGrid>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </DashboardGrid>
      ) : (
        <DashboardGrid>
          <StatCard
            label="Статус"
            value={isRunning ? 'Online' : 'Offline'}
            icon={CheckSquare}
            variant={isRunning ? 'success' : 'destructive'}
          />
          <StatCard
            label="Порт"
            value={String(cfg?.port || 3456)}
            icon={Server}
          />
          <StatCard
            label="OIDC"
            value={cfg?.oidc.enabled ? cfg.oidc.provider : 'Выкл'}
            icon={Shield}
            variant={cfg?.oidc.enabled ? 'success' : 'default'}
          />
          <StatCard
            label="SMTP"
            value={cfg?.smtp.enabled ? cfg.smtp.from : 'Выкл'}
            icon={Mail}
            variant={cfg?.smtp.enabled ? 'success' : 'default'}
          />
        </DashboardGrid>
      )}

      {/* Домены */}
      <Card>
        <CardHeader>
          <CardTitle>Доступ к планировщику</CardTitle>
          <CardDescription>Vikunja доступен по следующим адресам (вход через Authelia SSO)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {urls.map((url) => (
              <div key={url} className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="font-mono text-sm">{url}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={isRunning ? 'running' : 'stopped'} />
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Конфигурация */}
      {cfg && (
        <Card>
          <CardHeader>
            <CardTitle>Конфигурация</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Сервер */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Server className="h-4 w-4" /> Сервер
                </h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Префикс</dt>
                    <dd className="font-mono">{cfg.prefix}.{cfg.middle}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Порт</dt>
                    <dd className="font-mono">{cfg.port}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Frontend URL</dt>
                    <dd className="font-mono text-xs">{cfg.frontendUrl}</dd>
                  </div>
                </dl>
              </div>

              {/* OIDC */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Shield className="h-4 w-4" /> OpenID Connect
                </h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Провайдер</dt>
                    <dd>{cfg.oidc.provider}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Client ID</dt>
                    <dd className="font-mono">{cfg.oidc.clientId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Issuer</dt>
                    <dd className="font-mono text-xs">{cfg.oidc.issuerUrl}</dd>
                  </div>
                </dl>
              </div>

              {/* SMTP */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Mail className="h-4 w-4" /> SMTP (Mailu)
                </h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Хост</dt>
                    <dd className="font-mono">{cfg.smtp.host}:{cfg.smtp.port}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Отправитель</dt>
                    <dd className="font-mono">{cfg.smtp.from}</dd>
                  </div>
                </dl>
              </div>

              {/* CalDAV */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" /> CalDAV
                </h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Статус</dt>
                    <dd>{cfg.caldav.enabled ? 'Включён' : 'Выключен'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">URL</dt>
                    <dd className="font-mono text-xs">{cfg.caldav.url}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Возможности */}
      <Card>
        <CardHeader>
          <CardTitle>Возможности</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            <li>Списки задач, Kanban-доска, календарь (день/неделя/месяц), Gantt</li>
            <li>Авторизация через Authelia SSO (OpenID Connect)</li>
            <li>Email-напоминания через Mailu SMTP</li>
            <li>CalDAV -- синхронизация с мобильными календарями (DAVx5, iOS)</li>
            <li>REST API для автоматизации</li>
            <li>Метки, фильтры, повторяющиеся задачи, вложения</li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
