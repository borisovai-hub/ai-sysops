import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const MAX_RETRY_MS = 30_000;

export function useMonitoringSSE(enabled: boolean): void {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(1000);

  useEffect(() => {
    if (!enabled) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;

    function connect() {
      const url = `/api/monitoring/sse?token=${encodeURIComponent(token!)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        retryRef.current = 1000;
      };

      es.onmessage = (event) => {
        let parsed: { type?: string };
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (parsed.type) {
          case 'status_update':
          case 'status_change':
            qc.invalidateQueries({ queryKey: ['monitoring', 'status'] });
            break;
          case 'new_alert':
            qc.invalidateQueries({ queryKey: ['monitoring', 'alerts'] });
            break;
          case 'heartbeat':
            break;
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;

        const delay = retryRef.current;
        retryRef.current = Math.min(delay * 2, MAX_RETRY_MS);

        setTimeout(() => {
          if (esRef.current === null) {
            connect();
          }
        }, delay);
      };
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [enabled, qc]);
}
