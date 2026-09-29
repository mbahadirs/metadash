/**
 * Fake TikTok APIs (open.tiktokapis.com v2: oauth token/revoke, user/info, video/list, video/query) — EMPTY STUB
 * (v2.0 chunk B). Chunk C2 owns this file. Returns a fakeFetch handler for the `tiktok` host group:
 *   createFakeFetch({ tiktok: [tiktokApi({ now })] })
 */
export function tiktokApi() {
  return () => null;
}
