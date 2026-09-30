import net from 'node:net';

/**
 * Client address used as the rate-limit / lockout key.
 * Without MD_TRUST_PROXY the socket peer is the client. With it, X-Forwarded-For is honoured only when the socket peer
 * itself is a private/loopback address (the Caddy container, a LAN proxy), and then the RIGHT-MOST entry that is not a
 * private hop is used: proxies append the address they saw, so everything to its left is client-controlled and can be
 * spoofed. When every hop is private the right-most entry wins; unusable headers fall back to the socket peer.
 */
const PRIVATE = new net.BlockList();
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT / Tailscale
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

/** '::ffff:1.2.3.4' → '1.2.3.4', '[::1]' → '::1'; null when not an IP address. */
export function normalizeIp(value) {
  let s = String(value ?? '').trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped) s = mapped[1];
  return net.isIP(s) ? s.toLowerCase() : null;
}

export function isPrivateIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;
  return PRIVATE.check(ip, net.isIPv4(ip) ? 'ipv4' : 'ipv6');
}

/** @param {{ trustProxy: boolean, remoteAddress?: string, forwardedFor?: string|string[] }} p */
export function clientKeyFor({ trustProxy, remoteAddress, forwardedFor }) {
  const peer = normalizeIp(remoteAddress) ?? (remoteAddress || 'unknown');
  if (!trustProxy || !isPrivateIp(peer)) return peer;
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(',') : String(forwardedFor ?? '');
  const hops = raw.split(',').map((h) => h.trim()).filter(Boolean);
  let rightmost = null;
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = normalizeIp(hops[i]);
    if (!ip) break; // garbage: nothing further left can be trusted
    rightmost ??= ip;
    if (!isPrivateIp(ip)) return ip;
  }
  return rightmost ?? peer;
}
