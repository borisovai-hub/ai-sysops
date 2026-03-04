import { type ComponentType } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: number | string | undefined;
  icon: ComponentType<{ className?: string }>;
  variant?: 'default' | 'success' | 'warning' | 'destructive';
}

const variantColors = {
  default: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

export function StatCard({ label, value, icon: Icon, variant = 'default' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value ?? '—'}</p>
          </div>
          <Icon className={cn('h-8 w-8', variantColors[variant])} />
        </div>
      </CardContent>
    </Card>
  );
}
