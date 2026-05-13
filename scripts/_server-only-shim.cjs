/**
 * Preload hook for tsx-run scripts that import server-only modules.
 *
 * Does two jobs that both need to happen BEFORE the script's imports
 * resolve — Node loads `--require` files before any ESM imports hoist:
 *
 *   1. Stubs out `server-only` (Next.js's webpack-aliased no-op marker)
 *      so transitive imports of it don't fail with MODULE_NOT_FOUND.
 *
 *   2. Loads `apps/web/.env.local` into process.env so library modules
 *      that read env at module init (e.g. `EMAIL_FROM` in lib/email.ts)
 *      see the right values.
 *
 * Use via `node --require ./scripts/_server-only-shim.cjs ...`.
 */

const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

// --- 1. server-only resolver shim ------------------------------------------

const origResolve = Module._resolveFilename;
const EMPTY = path.join(__dirname, '_empty-module.cjs');
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return EMPTY;
  return origResolve.call(this, request, ...rest);
};

// --- 2. dotenv load --------------------------------------------------------

const envPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
