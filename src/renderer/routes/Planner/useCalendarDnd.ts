import { useCallback, useState, type DragEvent } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { plannerApi, PLANNER_KEY } from '@/hooks/usePlanner';
import type { PlannerPostSummary, PostStatus } from '@/lib/types';
import { useToast } from './Toast';
import { PAST_GRACE_MS, canReschedule, errorText } from './lib';

export const DND_MIME = 'application/x-metadash-post';

interface DragPayload { id: number; scheduledAt: number | null; ref: string; status?: PostStatus }

/**
 * Native HTML5 drag and drop for calendar items (plan §11):
 * - drop on a month day keeps the time of day; drop on a week hour cell sets the time (15-min snap);
 * - Alt/Option while dropping duplicates instead of moving; drops in the past are rejected;
 * - optimistic update of every cached list, rolled back on error.
 * `move()` is the keyboard path (reschedule dialog, Alt+arrow keys) and shares the same logic.
 */
export function useCalendarDnd() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [dragging, setDragging] = useState<number | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const move = useCallback(async (post: Pick<PlannerPostSummary, 'id' | 'ref' | 'scheduledAt'> & { status?: PostStatus }, at: number | null, duplicate = false) => {
    if (at == null && post.status === 'scheduled') { toast(t('pl_unschedule_first'), 'error'); return false; }
    if (at != null && at < Date.now() - PAST_GRACE_MS) { toast(t('pl_drop_past'), 'error'); return false; }
    if (!duplicate && at === post.scheduledAt) return false;
    const listKey = [PLANNER_KEY, 'list'];
    const snapshot = qc.getQueriesData<PlannerPostSummary[]>({ queryKey: listKey });
    if (!duplicate) {
      qc.setQueriesData<PlannerPostSummary[]>({ queryKey: listKey }, (old) => old?.map((p) => (p.id === post.id ? { ...p, scheduledAt: at } : p)));
    }
    try {
      if (duplicate) {
        const created = await plannerApi.duplicate(post.id, at);
        toast(t('pl_duplicated', { ref: created.ref }), 'ok');
      } else {
        const res = await plannerApi.reschedule(post.id, at);
        const warn = res.warnings?.length ? ` ${t('pl_warnings_n', { n: res.warnings.length })}` : '';
        toast(`${t('pl_rescheduled', { ref: post.ref })}${warn}`, res.warnings?.length ? 'info' : 'ok');
      }
      return true;
    } catch (e) {
      for (const [key, data] of snapshot) qc.setQueryData(key as QueryKey, data);
      toast(errorText(e), 'error');
      return false;
    } finally {
      qc.invalidateQueries({ queryKey: [PLANNER_KEY] });
    }
  }, [qc, t, toast]);

  const dragProps = useCallback((post: PlannerPostSummary) => {
    const draggable = canReschedule(post.status);
    return {
      draggable,
      onDragStart: (e: DragEvent) => {
        if (!draggable) return;
        const payload: DragPayload = { id: post.id, scheduledAt: post.scheduledAt, ref: post.ref, status: post.status };
        e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'copyMove';
        setDragging(post.id);
      },
      onDragEnd: () => { setDragging(null); setOverKey(null); },
    };
  }, []);

  /** Props for a drop zone. `resolve` turns the drop event + previous time into the new time. */
  const dropProps = useCallback((key: string, resolve: (e: DragEvent, prev: number | null) => number) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DND_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      if (overKey !== key) setOverKey(key);
    },
    onDragLeave: () => setOverKey((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      const raw = e.dataTransfer.getData(DND_MIME);
      setOverKey(null);
      setDragging(null);
      if (!raw) return;
      e.preventDefault();
      let payload: DragPayload;
      try { payload = JSON.parse(raw) as DragPayload; } catch { return; }
      if (typeof payload?.id !== 'number') return;
      void move(payload, resolve(e, payload.scheduledAt), e.altKey);
    },
  }), [move, overKey]);

  return { move, dragProps, dropProps, dragging, overKey };
}

export type CalendarDnd = ReturnType<typeof useCalendarDnd>;
