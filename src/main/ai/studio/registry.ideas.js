/**
 * AI studio registry for v1.5 chunk C: ideas and repurpose (studio:ideas:*, studio:repurpose*).
 * Owned by chunk C — ai/studio/index.js imports this file by its fixed name, so no shared file needs editing.
 *
 * handlers: { 'studio:<channel>': async (payload, ctx) => result }   ctx = { event }
 *   Use ai/studio/runtime.js (runGeneration, assertAccountsAllowed, …) for every model call.
 * previews: { <feature>: async (params) => ({ items, text, images?, expectedOutputTokens? }) }   (studio:preview)
 */
export const registry = {
  handlers: {},
  previews: {},
};
