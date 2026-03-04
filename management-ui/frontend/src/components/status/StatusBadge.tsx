import { Badge, type BadgeProps } from '@/components/ui/badge';

type Status = 'running' | 'stopped' | 'partial' | 'error' | 'ok' | 'unknown';

const statusConfig: Record<Status, { label: string; variant: BadgeProps['variant']; dot: string }> = {
  running: { label: 'Running', variant: 'success', dot: 'bg-success' },
  ok: { label: 'OK', variant: 'success', dot: 'bg-success' },
  stopped: { label: 'Stopped', variant: 'secondary', dot: 'bg-muted-foreground' },
  partial: { label: 'Partial', variant: 'warning', dot: 'bg-warning' },
  error: { label: 'Error', variant: 'destructive', dot: 'bg-destructive' },
  unknown: { label: 'Unknown', variant: 'outline', dot: 'bg-muted-foreground' },
};

interface StatusBadgeProps {
  status: Status | string;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const cfg = statusConfig[status as Status] ?? statusConfig.unknown;
  return (
    <Badge variant={cfg.variant} className="gap-1.5">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {label ?? cfg.label}
    </Badge>
  );
}
