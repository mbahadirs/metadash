import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { presign, objectUrl, encodeKey, amzDate } from '../src/main/publishing/hosts/sigv4.js';
import { createS3Host, checkS3Settings } from '../src/main/publishing/hosts/s3.js';
import { createUrlHost } from '../src/main/publishing/hosts/url.js';
import { getMediaHostSettings, setMediaHostSettings, createMediaHost, ensureHosted, cleanupUploads, isHostConfigured } from '../src/main/publishing/hosts/index.js';
import { listUploads } from '../src/main/db/queries/planner.js';
import { getSetting } from '../src/main/db/queries/settings.js';
import { createPublishWorld, setupPublishingDb } from './fixtures/graph/publish.js';

const AWS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const T0 = Date.UTC(2013, 4, 24);

describe('SigV4 presigning', () => {
  it('matches the AWS documented presigned GET example', () => {
    const url = objectUrl({ region: 'us-east-1', bucket: 'examplebucket', key: 'test.txt' });
    const signed = presign({ method: 'GET', url, region: 'us-east-1', ...AWS, expiresSec: 86400, now: T0 });
    expect(signed).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('builds virtual-host and path-style URLs (custom endpoint with port, regional AWS host)', () => {
    expect(objectUrl({ endpoint: 'http://localhost:9000', bucket: 'media', key: 'a/b c.jpg', pathStyle: true }).toString()).toBe('http://localhost:9000/media/a/b%20c.jpg');
    expect(objectUrl({ region: 'eu-central-1', bucket: 'media', key: 'x.jpg' }).host).toBe('media.s3.eu-central-1.amazonaws.com');
    expect(objectUrl({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'media', key: 'k.jpg' }).host).toBe('media.acc.r2.cloudflarestorage.com');
  });

  it('R2 region "auto" goes into the credential scope; the signed host includes the port', () => {
    const url = objectUrl({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'media', key: 'k.jpg', pathStyle: true });
    const signed = new URL(presign({ method: 'PUT', url, region: 'auto', ...AWS, expiresSec: 900, now: T0 }));
    expect(signed.searchParams.get('X-Amz-Credential')).toBe('AKIAIOSFODNN7EXAMPLE/20130524/auto/s3/aws4_request');
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('900');
    const put = presign({ method: 'PUT', url, region: 'auto', ...AWS, expiresSec: 900, now: T0 });
    const get = presign({ method: 'GET', url, region: 'auto', ...AWS, expiresSec: 900, now: T0 });
    expect(put).not.toBe(get); // the method is part of the signature
  });

  it('encodes keys per RFC 3986 and caps expiry at 7 days', () => {
    expect(encodeKey("metadash/it's (1)*.jpg")).toBe('metadash/it%27s%20%281%29%2A.jpg');
    expect(amzDate(T0)).toBe('20130524T000000Z');
    const url = objectUrl({ region: 'us-east-1', bucket: 'b', key: 'k' });
    expect(new URL(presign({ method: 'GET', url, region: 'us-east-1', ...AWS, expiresSec: 30 * 86400, now: T0 })).searchParams.get('X-Amz-Expires')).toBe('604800');
  });
});

describe('S3 host', () => {
  const settings = { endpoint: 'https://s3.test', region: 'auto', bucket: 'media', prefix: 'metadash/', pathStyle: true, publicBaseUrl: '', urlTtlSec: 3600, deleteAfterPublish: true };
  const creds = { accessKeyId: 'AKID1234', secretAccessKey: 'secret' };
  const blob = async () => new Blob(['x']);

  it('rejects incomplete settings and non-https endpoints (localhost http allowed)', () => {
    expect(() => checkS3Settings({ ...settings, bucket: '' }, creds)).toThrow(/bucket/);
    expect(() => checkS3Settings(settings, {})).toThrow(/accessKeyId/);
    expect(() => checkS3Settings({ ...settings, endpoint: 'http://example.com' }, creds)).toThrow(/endpoint/);
    expect(checkS3Settings({ ...settings, endpoint: 'http://127.0.0.1:9000' }, creds).bucket).toBe('media');
  });

  it('uploads with a presigned PUT and hands Meta a presigned GET (TTL) or the public base URL', async () => {
    const world = createPublishWorld();
    const host = createS3Host({ settings, credentials: creds, fetchImpl: world.fetch, now: () => T0, openAsBlob: blob });
    const up = await host.upload({ name: 'abc.jpg', filePath: '/x', mime: 'image/jpeg' });
    const put = world.find('PUT', '/media/metadash/abc.jpg')[0];
    expect(put.headers['content-type']).toBe('image/jpeg');
    expect(put.url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(up.objectKey).toBe('metadash/abc.jpg');
    expect(new URL(up.publicUrl).searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(up.expiresAt).toBe(T0 + 3600_000);
    const cdn = createS3Host({ settings: { ...settings, publicBaseUrl: 'https://cdn.example.com/' }, credentials: creds, fetchImpl: world.fetch, openAsBlob: blob });
    expect((await cdn.upload({ name: 'abc.jpg', filePath: '/x', mime: 'image/jpeg' })).publicUrl).toBe('https://cdn.example.com/metadash/abc.jpg');
    await host.cleanup(up);
    expect(world.find('DELETE', '/media/metadash/abc.jpg')).toHaveLength(1);
  });

  it('connection test: PUT, anonymous GET expecting image/jpeg, DELETE', async () => {
    const world = createPublishWorld();
    const host = createS3Host({ settings, credentials: creds, fetchImpl: world.fetch });
    const res = await host.test();
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(world.calls.map((c) => c.method)).toEqual(['PUT', 'GET', 'DELETE']);
    world.override((req) => (req.method === 'GET' ? new Response('denied', { status: 403 }) : undefined));
    const bad = await host.test();
    expect(bad).toMatchObject({ ok: false, status: 403 });
  });

  it('a failed PUT is a config error with the HTTP status (5xx → transient)', async () => {
    const world = createPublishWorld();
    world.override((req) => (req.method === 'PUT' ? new Response('', { status: 403 }) : undefined));
    const host = createS3Host({ settings, credentials: creds, fetchImpl: world.fetch, openAsBlob: blob });
    await expect(host.upload({ name: 'a.jpg', filePath: '/x', mime: 'image/jpeg' })).rejects.toMatchObject({ kind: 'config', code: 's3_403' });
  });
});

describe('url host', () => {
  it('checks the mirrored file with HEAD and refuses converted variants', async () => {
    const world = createPublishWorld();
    world.state.s3.set('/media/abc.jpg', { type: 'image/jpeg' });
    const host = createUrlHost({ baseUrl: 'https://files.s3.test/media/', fetchImpl: world.fetch });
    expect((await host.upload({ name: 'abc.jpg' })).publicUrl).toBe('https://files.s3.test/media/abc.jpg');
    await expect(host.upload({ name: 'missing.jpg' })).rejects.toMatchObject({ key: 'pub_url_unreachable' });
    await expect(host.upload({ name: 'abc-ig1440.jpg', variant: 'ig1440' })).rejects.toMatchObject({ key: 'pub_url_needs_original' });
  });
});

describe('media host settings + uploads (DB)', () => {
  let db;
  beforeAll(() => { db = setupPublishingDb('metadash-s3-'); });
  afterAll(() => db.cleanup());

  it('stores S3 keys encrypted and never returns the secret', () => {
    expect(getMediaHostSettings().type).toBe('none');
    expect(isHostConfigured()).toBe(false);
    const saved = setMediaHostSettings({ type: 's3', s3: { endpoint: 'https://s3.test', bucket: 'media', pathStyle: true, region: 'auto' }, accessKeyId: 'AKIDLAST', secretAccessKey: 'super-secret' });
    expect(saved.keySet).toEqual({ last4: 'LAST' });
    expect(JSON.stringify(saved)).not.toContain('super-secret');
    expect(String(getSetting('token:planner:s3'))).toMatch(/^gcm:/);
    expect(saved.s3.prefix).toBe('metadash/');
    expect(isHostConfigured()).toBe(true);
    // keys are kept when not re-sent
    expect(setMediaHostSettings({ type: 's3', s3: { bucket: 'media2' } }).keySet).toEqual({ last4: 'LAST' });
    expect(() => setMediaHostSettings({ type: 'ftp' })).toThrow();
    expect(() => setMediaHostSettings({ type: 's3', s3: { urlTtlSec: 'x' } })).toThrow();
  });

  it('ensureHosted uploads once and reuses a still-valid upload; cleanup deletes and marks it', async () => {
    const world = createPublishWorld();
    setMediaHostSettings({ type: 's3', s3: { endpoint: 'https://s3.test', bucket: 'media', pathStyle: true, urlTtlSec: 86400 }, accessKeyId: 'AKIDLAST', secretAccessKey: 'super-secret' });
    const host = createMediaHost({ fetchImpl: world.fetch, openAsBlob: async () => new Blob(['x']) });
    const asset = db.makeAsset();
    const filePath = path.join(db.mediaRoot, asset.storedPath);
    expect(fs.existsSync(filePath)).toBe(true);
    const a = await ensureHosted({ host, assetId: asset.id, name: asset.storedPath, filePath, mime: 'image/jpeg', kind: 'image' });
    const b = await ensureHosted({ host, assetId: asset.id, name: asset.storedPath, filePath, mime: 'image/jpeg', kind: 'image' });
    expect(b).toEqual(a);
    expect(world.find('PUT', /\/media\/metadash\//)).toHaveLength(1);
    await expect(ensureHosted({ host: null, assetId: asset.id, name: 'x', filePath, mime: 'image/jpeg', kind: 'image' })).rejects.toMatchObject({ key: 'pub_host_missing' });
    expect(await cleanupUploads({ host, uploads: listUploads({ assetId: asset.id }) })).toBe(1);
    expect(listUploads({ assetId: asset.id })).toHaveLength(0);
    expect(world.find('DELETE', /\/media\/metadash\//)).toHaveLength(1);
  });
});
