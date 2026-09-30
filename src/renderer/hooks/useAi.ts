import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import { useStaffSession } from './useSession';

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export interface AiKeyStatus { set: boolean; last4: string | null }
export interface AiStatus {
  enabled: boolean; provider: AiProvider; model: string; ollamaUrl: string;
  providers: AiProvider[]; anthropicModels: string[]; defaultModels: Record<AiProvider, string>;
  keys: Partial<Record<AiProvider, AiKeyStatus>>;
}
export interface AiAnswer { text: string; truncated: boolean; provider: AiProvider; model: string }

export const AI_STATUS_KEY = ['ai-status'];

/** Not queried in the client view (ai:status is outside its allowlist; AI stays hidden there). */
export const useAiStatus = () => {
  const staff = useStaffSession();
  return useQuery<AiStatus>({ queryKey: AI_STATUS_KEY, queryFn: () => call(api.ai.status()), enabled: staff });
};

/** True only when the user opted in; AI buttons stay hidden otherwise. */
export function useAiEnabled() {
  return useAiStatus().data?.enabled === true;
}
