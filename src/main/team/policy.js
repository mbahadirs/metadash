/**
 * IPC policy — STUB that allows everything (v2.0 chunk B). Chunk F1 owns this file.
 * ipc/index.js handle() calls check(channel, args, session) before every handler; throwing denies the call (use
 * denied() so the renderer gets { code: 'FORBIDDEN' }). Contract (plan §5): admin-only channels (setup:*, settings:set
 * except ui.* / lang / theme, transfer:*, db:*, worker:*, ai:setKey, team:create), read-only workspaces block sync:*,
 * inbox:reply / inbox:hide and publishing, the client role is default-deny with an allowlist.
 */
export function check(channel, args, session) {
  void channel; void args; void session;
}

export function denied(channel) {
  return Object.assign(new Error(`Not allowed: ${channel}`), { code: 'FORBIDDEN' });
}
