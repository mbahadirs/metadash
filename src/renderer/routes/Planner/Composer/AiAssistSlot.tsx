import type { ComposerState } from './state';

/**
 * Mount point for v1.5 "AI studio" composer tools (caption ideas, hashtags, alt text). Intentionally empty in v1.4 so
 * v1.5 can fill it without editing ComposerDrawer.
 */
export function AiAssistSlot(_props: { state: ComposerState; disabled: boolean; onChange: (patch: Partial<ComposerState>) => void }) {
  return null;
}
