import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

/** Follows 'app:navigate' events from the main process (e.g. a clicked desktop notification). */
export function useNavigateEvents() {
  const navigate = useNavigate();
  useEffect(() => api.on('app:navigate', (p: { route?: unknown }) => {
    if (typeof p?.route === 'string' && p.route.startsWith('/')) navigate(p.route);
  }), [navigate]);
}
