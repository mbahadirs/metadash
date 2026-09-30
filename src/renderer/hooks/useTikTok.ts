import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import type { TikTokSetupState } from '@/lib/types';

/** TikTok connection state + actions (setup:tiktok:* channels, v2.0 chunk C2). */
export const TIKTOK_STATE_KEY = ['tiktokState'] as const;

export function useTikTokState() {
  return useQuery<TikTokSetupState>({ queryKey: TIKTOK_STATE_KEY, queryFn: () => call(api.setup.tiktok.getState()), retry: false });
}

export interface TikTokClientInput { clientKey: string; clientSecret: string; redirectUri?: string; sandbox?: boolean }
export interface TikTokConnectResult { accountId: string; username: string }

export const tiktokApi = {
  saveClient: (p: TikTokClientInput) => call<{ clientKey: string }>(api.setup.tiktok.saveClient(p)),
  connect: () => call<TikTokConnectResult>(api.setup.tiktok.connect()),
  cancelConnect: () => call<boolean>(api.setup.tiktok.cancelConnect()),
  authUrl: () => call<{ url: string; state: string }>(api.setup.tiktok.authUrl()),
  exchangeCode: (p: { code: string; state: string }) => call<TikTokConnectResult>(api.setup.tiktok.exchangeCode(p)),
  saveTracked: (accountIds: string[]) => call<{ accountIds: string[] }>(api.setup.tiktok.saveTracked(accountIds)),
  disconnect: (p: { profileId: number; deleteData: boolean }) => call<boolean>(api.setup.tiktok.disconnect(p)),
};

/** Invalidates everything a TikTok connection change affects. */
export function useTikTokRefresh(onChange?: () => void) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: TIKTOK_STATE_KEY });
    qc.invalidateQueries({ queryKey: ['platforms'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    onChange?.();
  };
}
