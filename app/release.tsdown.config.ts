// Release build: ONE self-contained server bundle (every package inlined), so a workspace never runs npm install.
// Dev-only tools (Vite, TypeScript, tsx) stay external: production never loads them.
import { appkitServerConfig } from '@databricks/appkit/tsdown';

const DEV_ONLY = /(^|\/node_modules\/)(vite|rolldown-vite|rolldown|@vitejs\/|lightningcss|fsevents|esbuild|tsx|typescript|@rollup\/|bufferutil|utf-8-validate)(\/|$)|\.node$/;

// @ast-grep/napi is a native module used only by AppKit's type generator and lint (never at runtime). Its loader
// would demand a platform binary at start-up, so the release build gets a stand-in that fails loudly if ever called.
const STUB = '\0stub-ast-grep-napi';
const stubAstGrep = {
  name: 'stub-ast-grep-napi',
  resolveId(id: string) {
    return /^@ast-grep\/napi($|-)/.test(id) ? STUB : null;
  },
  load(id: string) {
    if (id !== STUB) return null;
    return `const unavailable = () => { throw new Error('@ast-grep/napi is not included in the release build (dev tooling only)'); };
export const parse = unavailable, parseAsync = unavailable, parseFiles = unavailable, findInFiles = unavailable, pattern = unavailable, kind = unavailable;
export const Lang = new Proxy({}, { get: () => unavailable });
export const ts = { parse: unavailable }, tsx = { parse: unavailable }, js = { parse: unavailable }, jsx = { parse: unavailable }, css = { parse: unavailable }, html = { parse: unavailable };
export default { parse: unavailable, parseAsync: unavailable, findInFiles: unavailable, Lang };`;
  },
};

export default appkitServerConfig((base) => ({
  ...base,
  plugins: [stubAstGrep],
  unbundle: false,
  outDir: 'release/server',
  platform: 'node',
  format: 'esm',
  target: 'node20',
  shims: true,
  clean: true,
  external: (id: string) => DEV_ONLY.test(id),
  noExternal: (id: string) => !DEV_ONLY.test(id),
  outExtensions: () => ({ js: '.mjs' }),
}));
