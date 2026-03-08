import { useEffect, useRef } from 'react';

const SYNC_KEY = 'cross_domain_synced';

/**
 * After Authelia login on one domain (.ru or .tech),
 * automatically establish a session on the other domain.
 * Uses a one-time token + redirect chain (runs once per browser session).
 */
export function useCrossDomainSync() {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (sessionStorage.getItem(SYNC_KEY)) return;
    attempted.current = true;

    // Mark as attempted immediately to prevent loops
    sessionStorage.setItem(SYNC_KEY, '1');

    fetch('/api/auth/cross-sync', { method: 'POST', credentials: 'include' })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ syncUrl: string; targetDomain: string }>;
      })
      .then((data) => {
        if (!data?.syncUrl) return;
        // Redirect to other domain to set the session cookie,
        // which will redirect back here via the `rd` parameter.
        window.location.href = data.syncUrl;
      })
      .catch(() => {
        // Silently ignore — sync is best-effort
      });
  }, []);
}
