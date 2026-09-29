import { useQuery } from '@tanstack/react-query';
import { api, call } from '@/lib/api';

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export interface AiKeyStatus { set: boolean; last4: string | null }
export interface AiStatus {
  enabled: boolean; provider: AiProvider; model: string; ollamaUrl: string;
  providers: AiProvider[]; anthropicModels: string[]; defaultModels: Record<AiProvider, string>;
  keys: Partial<Record<AiProvider, AiKeyStatus>>;
}
export interface AiAnswer { text: string; truncated: boolean; provider: AiProvider; model: string }

export const AI_STATUS_KEY = ['ai-status'];

export const useAiStatus = () => useQuery<AiStatus>({ queryKey: AI_STATUS_KEY, queryFn: () => call(api.ai.status()) });

/** True only when the user opted in; AI buttons stay hidden otherwise. */
export function useAiEnabled() {
  return useAiStatus().data?.enabled === true;
}
