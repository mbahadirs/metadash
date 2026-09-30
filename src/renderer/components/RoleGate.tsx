import type { ReactNode } from 'react';
import type { Role } from '@/lib/types';
import { useSession } from '@/hooks/useSession';

/**
 * Renders children only for the given roles (and, with `writable`, only outside a read-only shared workspace).
 * A UI guardrail; the main process enforces the same rules in team/policy.js.
 */
export function RoleGate({ allow, writable = false, fallback = null, children }: { allow?: Role[]; writable?: boolean; fallback?: ReactNode; children: ReactNode }) {
  const session = useSession();
  const roleOk = !allow || allow.includes(session.role);
  const writeOk = !writable || !session.readOnly;
  return <>{roleOk && writeOk ? children : fallback}</>;
}
