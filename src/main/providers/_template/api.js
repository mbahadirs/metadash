/**
 * TEMPLATE — HTTP calls for the platform. Use global fetch (tests stub it with tests/fixtures/fakeFetch.js, routed by
 * host) and map vendor errors to MetaError-compatible errors: token errors → code 190 (auth), permission → 10/200,
 * rate limits → a backoff, quota → a soft error. Never log tokens.
 */
export const API_BASE = 'https://api.example.com/v1';

/** @param {string} token @returns {Promise<{id:string, username:string, followers?:number}>} */
export async function fetchMe(token, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`example api ${res.status}`);
  return res.json();
}
