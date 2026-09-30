import net from 'node:net';
import { normalizeUrl } from './client.js';

/**
 * Where a worker URL points, for the pairing review (Settings → Self-hosted worker) and for the configure guard:
 * the shared secret and the publishing tokens go to this address, so plain http:// is only accepted without an extra
 * confirmation (allowInsecureHttp) for loopback / private-network targets (LAN, Docker, Tailscale 100.64/10, *.local).
 */
const PRIVATE = new net.BlockList();
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

export function isLocalHost(hostname) {
  const h = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  const ip = mapped ? mapped[1] : h;
  const v = net.isIP(ip);
  return v !== 0 && PRIVATE.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

/** @returns {{ url: string, scheme: 'http'|'https', host: string, local: boolean, insecure: boolean }} throws on a bad URL */
export function describeWorkerUrl(url) {
  const normalized = normalizeUrl(url);
  const u = new URL(normalized);
  const scheme = u.protocol === 'https:' ? 'https' : 'http';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const local = isLocalHost(host);
  return { url: normalized, scheme, host, local, insecure: scheme === 'http' && !local };
}
