/**
 * Fake Google APIs (OAuth token/revoke, YouTube Data API v3, YouTube Analytics v2) — EMPTY STUB (v2.0 chunk B).
 * Chunk C1 owns this file. Returns a fakeFetch handler for the `google` host group:
 *   createFakeFetch({ google: [googleApis({ now, channels: [...] })] })
 * Handler: ({ url, path, query, method, body }) → Response | null (null = not handled).
 */
export function googleApis() {
  return () => null;
}
