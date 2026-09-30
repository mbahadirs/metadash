import instagram from './instagram.js';
import facebook from './facebook.js';
import threads from './threads.js';

/**
 * Meta publishers shared by the desktop (src/main/publishing/platforms/*.js re-export them) and the self-hosted worker.
 * Interface (see src/main/publishing/platforms/index.js): platform, nativeSchedule, direct, firstPollDelayMs,
 * imageVariant, hostedItems, optionalHosted, needsPrepare, prepare, status, publish, recover, firstComment, quota
 * (+ Facebook scheduleNative / reconcile / reschedule / cancelNative).
 * ctx = { meta, threads (Graph clients: get/post/postForm/postBinary/del), tokenFor(auth), pageToken(pageId), now() }.
 */
export const SHARED_PUBLISHERS = Object.freeze({ instagram, facebook, threads });
export const PUBLISH_PLATFORMS = Object.freeze(Object.keys(SHARED_PUBLISHERS));

export const getSharedPublisher = (platform) => SHARED_PUBLISHERS[platform] ?? null;

/** Auth profile of a platform: Instagram and Facebook share the Meta login. */
export const authOf = (platform) => (platform === 'threads' ? 'threads' : 'meta');

export { instagram, facebook, threads };
export * from './errors.js';
export * from './util.js';
export { GRAPH_VERSION, GRAPH_BASE, THREADS_BASE, createFetchGraphClient, GraphError, GraphNetworkError, isMetaError } from './graph.js';
export * from './scopes.js';
