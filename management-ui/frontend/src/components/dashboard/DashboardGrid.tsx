import { type ReactNode } from 'react';

export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
      {children}
    </div>
  );
}
