import type { HealthCheckRow } from '@management-ui/shared';
import { Activity, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RelativeTime } from '@/components/shared/RelativeTime';
import { cn } from '@/lib/utils';

interface ServiceStatusCardProps {
  name: string;
  check: HealthCheckRow;
  onCheck?: () => void;
}

const statusConfig: Record<string, { label: string; variant: 'success' | 'destructive' | 'warning' }> = {
  up: { label: 'Up', variant: 'success' },
  down: { label: 'Down', variant: 'destructive' },
  degraded: { label: 'Degraded', variant: 'warning' },
};

export function ServiceStatusCard({ name, check, onCheck }: ServiceStatusCardProps) {
  const cfg = statusConfig[check.status] ?? statusConfig.down;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Activity
              className={cn(
                'h-4 w-4 shrink-0',
                check.status === 'up' && 'text-success',
                check.status === 'down' && 'text-destructive',
                check.status === 'degraded' && 'text-warning',
              )}
            />
            <span className="font-medium truncate">{name}</span>
          </div>
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {check.responseTimeMs != null ? `${check.responseTimeMs} ms` : '—'}
          </span>
          <RelativeTime date={check.checkedAt} />
        </div>

        {onCheck && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={onCheck}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Check
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
