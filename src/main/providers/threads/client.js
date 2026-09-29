import { createGraphClient } from '../../meta/client.js';
import { RateLimiter } from '../../meta/rateLimiter.js';

/**
 * Threads Graph API host. Meta documents both graph.threads.net and graph.threads.com as valid; every example on the
 * endpoint reference pages uses graph.threads.net (verified 2026-09-29). Change it here only.
 */
export const THREADS_HOST = 'https://graph.threads.net';
export const THREADS_API_VERSION = 'v1.0';
export const THREADS_BASE = `${THREADS_HOST}/${THREADS_API_VERSION}`;

/** Authorization window (on threads.com, not the Graph host). */
export const THREADS_AUTHORIZE_URL = 'https://threads.com/oauth/authorize';

/** Scopes MetaDash needs: profile + posts (threads_basic) and insights (threads_manage_insights). */
export const THREADS_SCOPES = ['threads_basic', 'threads_manage_insights'];

/** Earliest `since` accepted by /threads_insights (2024-04-13; data is only guaranteed from 2024-06-01). */
export const THREADS_MIN_SINCE_UNIX = 1712991600;

/** Threads has its own call quota (4800 × impressions / 24h), so it gets its own limiter. */
export const threadsLimiter = new RateLimiter({ baseDelayMs: Number(process.env.METADASH_GRAPH_DELAY_MS ?? 250) });

/** Threads Graph client; its MetaErrors carry source 'threads' (→ Threads-specific token message). */
export const threadsClient = createGraphClient({ base: THREADS_BASE, limiter: threadsLimiter, name: 'threads' });
