import crypto from 'node:crypto';

/**
 * AWS Signature Version 4 query-string presigning (S3 and S3-compatible stores: R2, B2, MinIO, Wasabi).
 * Only the `host` header is signed and the payload is UNSIGNED-PAYLOAD, so the presigned URL can be used by any
 * HTTP client (the PUT runs in main; Meta fetches the GET). Reference: AWS "Authenticating Requests: Using Query
 * Parameters (AWS Signature Version 4)" — the documented example is covered by tests/publishing.s3.test.js.
 */
export const MAX_PRESIGN_SEC = 7 * 86_400;

/** RFC 3986 encoding (encodeURIComponent leaves !'()* alone; SigV4 must encode them). */
export const uriEncode = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Object key → URL path segment(s), keeping '/' separators. */
export const encodeKey = (key) => String(key).split('/').map(uriEncode).join('/');

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');

/** 20130524T000000Z */
export const amzDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Default AWS endpoint for a region (us-east-1 uses the global host, as in AWS's examples). */
export function defaultEndpoint(region) {
  return !region || region === 'us-east-1' ? 'https://s3.amazonaws.com' : `https://s3.${region}.amazonaws.com`;
}

/**
 * URL of an object. Virtual-hosted style puts the bucket in the host name (AWS default); path style puts it in the
 * path (MinIO, some R2/B2 setups, buckets with dots).
 * @returns {URL}
 */
export function objectUrl({ endpoint, region, bucket, key, pathStyle = false }) {
  const base = new URL(endpoint || defaultEndpoint(region));
  const basePath = base.pathname.replace(/\/+$/, '');
  if (pathStyle) return new URL(`${base.protocol}//${base.host}${basePath}/${uriEncode(bucket)}/${encodeKey(key)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}${basePath}/${encodeKey(key)}`);
}

function signingKey(secret, date, region, service) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Presigns a request.
 * @param {{ method: string, url: URL, region: string, accessKeyId: string, secretAccessKey: string, expiresSec: number,
 *   now: number, service?: string }} p
 * @returns {string} absolute URL with X-Amz-* query parameters
 */
export function presign({ method, url, region, accessKeyId, secretAccessKey, expiresSec, now, service = 's3' }) {
  const datetime = amzDate(now);
  const date = datetime.slice(0, 8);
  const signRegion = region || 'us-east-1';
  const scope = `${date}/${signRegion}/${service}/aws4_request`;
  const expires = Math.max(1, Math.min(MAX_PRESIGN_SEC, Math.floor(expiresSec)));
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': datetime,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');
  const canonicalRequest = [method.toUpperCase(), url.pathname || '/', canonicalQuery, `host:${url.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', datetime, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretAccessKey, date, signRegion, service)).update(stringToSign, 'utf8').digest('hex');
  return `${url.protocol}//${url.host}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
