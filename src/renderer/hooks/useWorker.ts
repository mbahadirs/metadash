import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import type { WorkerExecutor, WorkerPairing, WorkerState, WorkerStatusEvent, WorkerToken } from '@/lib/types';

/** Self-hosted publish worker (v2.0 chunk E): state query refreshed on `worker:status`, and thin API wrappers. */
export const WORKER_KEY = ['worker', 'state'] as const;

/** WorkerState plus the fields the main process adds (sync state, notification preference). */
export type WorkerStateX = WorkerState & { state?: WorkerStatusEvent['state']; notify?: boolean };

/** Worker fields of a planner target (migration 014; not in the shared PlannerTarget type). */
export interface WorkerTargetFields {
  executor?: WorkerExecutor; revision?: number; workerRevision?: number | null; workerStatus?: string | null;
  workerError?: { code: string; message: string | null; transient?: boolean } | null; workerSyncedAt?: number | null;
}

export interface ExecutorResult { updated: number; skipped: { targetId: number; reason: string }[] }

export const workerApi = {
  state: () => call<WorkerStateX>(api.worker.getState()),
  generatePairing: () => call<WorkerPairing>(api.worker.generatePairing()),
  configure: (p: { url?: string; pairing?: string; secret?: string }) => call<WorkerStateX>(api.worker.configure(p)),
  preferences: (p: { defaultExecutor?: WorkerExecutor; enabled?: boolean; notify?: boolean }) => call<WorkerStateX>(api.worker.configure(p)),
  test: () => call<{ ok: boolean; version: string; protocol: number; latencyMs: number }>(api.worker.test()),
  tokens: () => call<WorkerToken[]>(api.worker.tokens()),
  pushToken: (p: { accountId: string; token?: string; allowBroader?: boolean }) => call<WorkerToken>(api.worker.pushToken(p)),
  revokeToken: (tokenKey: string) => call<WorkerToken[]>(api.worker.revokeToken(tokenKey)),
  syncNow: () => call<{ pushed: number; pulled: number; errors: unknown[] }>(api.worker.syncNow()),
  setExecutor: (targetIds: number[], executor: WorkerExecutor) => call<ExecutorResult>(api.worker.setExecutor({ targetIds, executor })),
  recall: (targetId: number) => call<{ recalled: boolean; reason?: string }>(api.worker.recall(targetId)),
  disconnect: () => call<boolean>(api.worker.disconnect()),
};

export function useWorkerState() {
  const qc = useQueryClient();
  useEffect(() => api.on('worker:status', () => { qc.invalidateQueries({ queryKey: WORKER_KEY }); }), [qc]);
  return useQuery<WorkerStateX>({ queryKey: WORKER_KEY, queryFn: workerApi.state });
}
