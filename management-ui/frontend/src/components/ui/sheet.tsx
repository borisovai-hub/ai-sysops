import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  side?: 'left' | 'right';
}

export function Sheet({ open, onOpenChange, children, side = 'left' }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in-0"
        onClick={() => onOpenChange(false)}
      />
      {/* panel */}
      <div
        ref={panelRef}
        className={cn(
          'absolute top-0 h-full w-[260px] bg-card border-border shadow-lg',
          'animate-in slide-in-from-left duration-200',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
          side === 'right' && 'slide-in-from-right',
        )}
      >
        {children}
      </div>
    </div>
  );
}
