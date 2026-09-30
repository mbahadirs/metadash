import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import type { TeamState, TeamMember, NoteV2, Session } from '@/lib/types';
import { refreshSession, useStaffSession } from './useSession';

/** Team workspace state, kept fresh by the team:status event. */
export function useTeamState() {
  const qc = useQueryClient();
  useEffect(() => api.on('team:status', () => { void qc.invalidateQueries({ queryKey: ['team'] }); }), [qc]);
  return useQuery<TeamState>({ queryKey: ['team', 'state'], queryFn: () => call(api.team.getState()) });
}

export function useTeamMembers() {
  return useQuery<TeamMember[]>({ queryKey: ['team', 'members'], queryFn: () => call(api.team.members()), staleTime: 60_000 });
}

/** Unseen notes mentioning me (the "Mentions" badge). */
export function useMentions() {
  const qc = useQueryClient();
  const staff = useStaffSession();
  useEffect(() => api.on('team:status', () => { void qc.invalidateQueries({ queryKey: ['mentions'] }); }), [qc]);
  return useQuery<NoteV2[]>({ queryKey: ['mentions'], queryFn: () => call(api.notes.mentions()), refetchInterval: 120_000, enabled: staff });
}

/** Mutation that refreshes team, notes and session afterwards. */
export function useTeamAction<TArgs, TRes = unknown>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation<TRes, Error, TArgs>({
    mutationFn: (args) => call(fn(args) as never) as Promise<TRes>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team'] });
      void qc.invalidateQueries({ queryKey: ['notes'] });
      void qc.invalidateQueries({ queryKey: ['mentions'] });
      void refreshSession();
    },
  });
}

export const sessionApi = {
  setRole: (role: 'admin' | 'analyst') => call<Session>(api.session.setRole(role)),
  enterClientView: (p: { clientNames: string[]; pin: string }) => call<Session>(api.session.enterClientView(p)),
  exitClientView: (p: { pin: string }) => call<Session>(api.session.exitClientView(p)),
};
