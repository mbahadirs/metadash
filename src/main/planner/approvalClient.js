/**
 * Script embedded in the approval-pack HTML (runs offline in the client's browser, no network, no Web Crypto so it also
 * works from file:// and in older browsers). `mdapLib` and `mdapUi` are serialised with Function#toString, so they must
 * stay self-contained (no imports, no outer variables). Tests call mdapLib() directly to check it against node:crypto.
 */
export const CODE_PREFIX = 'MDAP1';

/** SHA-256 / HMAC-SHA256 / base64url and the response-code builder. */
export function mdapLib() {
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function frac(x) { return ((x - Math.floor(x)) * 4294967296) >>> 0; }
  function constants() {
    var K = []; var H = []; var p = 2; var n = 0;
    while (n < 64) {
      var prime = true;
      for (var d = 2; d * d <= p; d += 1) if (p % d === 0) { prime = false; break; }
      if (prime) { if (n < 8) H[n] = frac(Math.pow(p, 1 / 2)); K[n] = frac(Math.pow(p, 1 / 3)); n += 1; }
      p += 1;
    }
    return { K: K, H: H };
  }
  function sha256(msg) {
    var c = constants(); var K = c.K; var H = c.H;
    var bytes = Array.prototype.slice.call(msg); var bl = msg.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bl / 4294967296);
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (bl >>> 24) & 255, (bl >>> 16) & 255, (bl >>> 8) & 255, bl & 255);
    var w = new Array(64);
    for (var i = 0; i < bytes.length; i += 64) {
      var t;
      for (t = 0; t < 16; t += 1) w[t] = ((bytes[i + 4 * t] << 24) | (bytes[i + 4 * t + 1] << 16) | (bytes[i + 4 * t + 2] << 8) | bytes[i + 4 * t + 3]) >>> 0;
      for (t = 16; t < 64; t += 1) {
        var x = w[t - 15]; var y = w[t - 2];
        var s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
        var s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0]; var b = H[1]; var cc = H[2]; var dd = H[3]; var e = H[4]; var f = H[5]; var g = H[6]; var h = H[7];
      for (t = 0; t < 64; t += 1) {
        var t1 = (h + ((rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0) + (((e & f) ^ (~e & g)) >>> 0) + K[t] + w[t]) >>> 0;
        var t2 = (((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0) + (((a & b) ^ (a & cc) ^ (b & cc)) >>> 0)) >>> 0;
        h = g; g = f; f = e; e = (dd + t1) >>> 0; dd = cc; cc = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + cc) >>> 0; H[3] = (H[3] + dd) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = [];
    for (var j = 0; j < 8; j += 1) out.push((H[j] >>> 24) & 255, (H[j] >>> 16) & 255, (H[j] >>> 8) & 255, H[j] & 255);
    return out;
  }
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(str));
    var s = unescape(encodeURIComponent(str)); var out = [];
    for (var i = 0; i < s.length; i += 1) out.push(s.charCodeAt(i));
    return out;
  }
  function hmacHex(key, message) {
    var k = utf8(key); if (k.length > 64) k = sha256(k);
    var ipad = []; var opad = [];
    for (var i = 0; i < 64; i += 1) { var kb = k[i] || 0; ipad.push(kb ^ 0x36); opad.push(kb ^ 0x5c); }
    var inner = sha256(ipad.concat(utf8(message)));
    return sha256(opad.concat(inner)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  function b64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function buildCode(prefix, packId, secret, items, by) {
    var body = prefix + '.' + b64url(utf8(JSON.stringify({ packId: packId, items: items, by: by || null })));
    return body + '.' + hmacHex(secret, body).slice(0, 8);
  }
  return { sha256: sha256, hmacHex: hmacHex, b64url: b64url, utf8: utf8, buildCode: buildCode };
}

/** Wires the per-post radio buttons, the "your name" field and the copy button to the response code. */
export function mdapUi(MDAP, PACK) {
  var out = document.getElementById('mdap-code');
  var status = document.getElementById('mdap-status');
  function collect() {
    var items = [];
    for (var i = 0; i < PACK.items.length; i += 1) {
      var it = PACK.items[i];
      var picked = document.querySelector('input[name="d-' + it.ref + '"]:checked');
      var note = document.getElementById('n-' + it.ref);
      var text = note ? note.value.trim().slice(0, 2000) : '';
      if (!picked && !text) continue;
      items.push({ ref: it.ref, v: it.v, d: picked ? picked.value : 'c', note: text || null });
    }
    return items;
  }
  function refresh() {
    var items = collect();
    var by = document.getElementById('mdap-by').value.trim().slice(0, 200);
    out.value = items.length ? MDAP.buildCode(PACK.prefix, PACK.packId, PACK.secret, items, by) : '';
    status.textContent = items.length ? PACK.labels.ready.replace('{n}', String(items.length)) : PACK.labels.empty;
  }
  document.addEventListener('change', refresh);
  document.addEventListener('input', refresh);
  document.getElementById('mdap-copy').addEventListener('click', function () {
    refresh();
    if (!out.value) return;
    out.focus(); out.select();
    var done = function () { status.textContent = PACK.labels.copied; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out.value).then(done, function () { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  });
  refresh();
}

/** JSON that is safe inside an inline <script> (no </script>, no U+2028/9 surprises). */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The full inline script for a pack. */
export function clientScript(pack) {
  return `(function(){var MDAP=(${mdapLib.toString()})();(${mdapUi.toString()})(MDAP,${scriptJson(pack)});})();`;
}
