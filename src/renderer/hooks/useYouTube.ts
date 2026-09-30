import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import type { YouTubeSetupState } from '@/lib/types';

/** YouTube connection state + actions (setup:youtube:* channels, v2.0 chunk C1). */
export const YOUTUBE_STATE_KEY = ['youtubeState'] as const;

export function useYouTubeState() {
  return useQuery<YouTubeSetupState>({ queryKey: YOUTUBE_STATE_KEY, queryFn: () => call(api.setup.youtube.getState()), retry: false });
}

export interface YouTubeConnectResult { accountId: string; title: string }

export const youtubeApi = {
  saveClient: (p: { clientId: string; clientSecret: string }) => call<{ clientId: string }>(api.setup.youtube.saveClient(p)),
  /** Opens Google's consent screen and resolves when the browser returns (reply: also ask for youtube.force-ssl). */
  connect: (p: { reply?: boolean } = {}) => call<YouTubeConnectResult>(api.setup.youtube.connect(p)),
  cancelConnect: () => call<boolean>(api.setup.youtube.cancelConnect()),
  saveTracked: (accountIds: string[]) => call<{ accountIds: string[] }>(api.setup.youtube.saveTracked(accountIds)),
  disconnect: (p: { profileId: number; deleteData: boolean }) => call<boolean>(api.setup.youtube.disconnect(p)),
};

/** Invalidates everything a YouTube connection change affects. */
export function useYouTubeRefresh(onChange?: () => void) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: YOUTUBE_STATE_KEY });
    qc.invalidateQueries({ queryKey: ['platforms'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    onChange?.();
  };
}
