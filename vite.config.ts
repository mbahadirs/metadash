import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Dev-server origins allowed in index.html's CSP for HMR; removed from production builds. */
const DEV_CONNECT_SOURCES = ['ws://localhost:5173', 'http://localhost:5173'];

/** Strips the Vite dev-server origins from the CSP connect-src in `vite build` output (dev keeps them for HMR). */
export function stripDevCsp(html: string): string {
  return html.replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i, (_m, pre: string, csp: string, post: string) => {
    const cleaned = csp.split(';').map((d) => {
      const parts = d.trim().split(/\s+/);
      return parts[0] === 'connect-src' ? parts.filter((src) => !DEV_CONNECT_SOURCES.includes(src)).join(' ') : d.trim();
    }).filter(Boolean).join('; ');
    return `${pre}${cleaned}${post}`;
  });
}

function productionCsp(): Plugin {
  return { name: 'metadash-production-csp', apply: 'build', transformIndexHtml: (html) => stripDevCsp(html) };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), productionCsp()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src/renderer') },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: { port: 5173, strictPort: true },
});
