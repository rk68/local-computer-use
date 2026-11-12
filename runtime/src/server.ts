import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, chmod, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ORIGIN, ROOT, errorText } from './config.ts';
import { Runtime } from './runtime.ts';

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:3210 ws://127.0.0.1:3210; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
export async function sessionToken() {
  const path = join(ROOT, '.cache/halo/session-token');
  if (process.env.HALO_SESSION_TOKEN) return process.env.HALO_SESSION_TOKEN;
  await mkdir(join(ROOT, '.cache/halo'), { recursive: true });
  if (!existsSync(path)) await writeFile(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  await chmod(path, 0o600); return (await readFile(path, 'utf8')).trim();
}
export function trusted(req: IncomingMessage, token: string, api: boolean, origin = ORIGIN) {
  if (req.headers.host !== new URL(origin).host) throw new Error('Use ' + origin);
  if (req.headers.origin !== undefined && req.headers.origin !== origin) throw new Error('Cross-origin requests are blocked.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new Error('Cross-site requests are blocked.');
  const supplied = Buffer.from(typeof req.headers['x-local-token'] === 'string' ? req.headers['x-local-token'] : '');
  if (api && (supplied.length !== Buffer.byteLength(token) || !timingSafeEqual(supplied, Buffer.from(token)))) throw new Error('Session token is missing. Reload this page.');
}
async function jsonBody(req: IncomingMessage, path: string): Promise<Record<string, unknown>> {
  if (req.headers['content-type'] !== 'application/json') throw new Error('Use application/json.');
  const limit = path === '/api/thread-context' ? 512000 : 16384;
  const declared = Number(req.headers['content-length']);
  if (!Number.isInteger(declared) || declared < 1 || declared > limit || req.headers['transfer-encoding']) throw new Error('Request body is empty or too large.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request body is too large.'); chunks.push(chunk); }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
  return body;
}
function send(res: ServerResponse, status: number, value: unknown, mime = 'application/json') {
  const data = mime === 'application/json' ? Buffer.from(JSON.stringify(value)) : Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  let csp = CSP;
  if (mime === 'image/svg+xml') {
    const hashes = [...data.toString().matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => "'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'");
    csp = "default-src 'none'; style-src " + (hashes.join(' ') || "'none'") + "; frame-ancestors 'none'; base-uri 'none'";
  }
  res.writeHead(status, { 'Content-Type': mime, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp, 'Referrer-Policy': 'no-referrer' });
  res.end(data);
}
function asset(path: string): [string, string] | null {
  if (path === '/') return ['index.html', 'text/html; charset=utf-8'];
  if (/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path)) return [path.slice(1), path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'];
  if (/^\/brand\/halo-(lockup|symbol)-(black|white)\.svg$/.test(path) || path === '/favicon.svg') return [path.slice(1), 'image/svg+xml'];
  if (path === '/fonts/outfit-variable.woff2') return [path.slice(1), 'font/woff2'];
  if (path === '/fonts/OUTFIT-OFL.txt') return [path.slice(1), 'text/plain; charset=utf-8'];
  if (path === '/favicon.ico') return [path.slice(1), 'image/x-icon'];
  if (/^\/(apple-touch-icon|icon-192|icon-512|favicon-16|favicon-32|favicon-48)\.png$/.test(path)) return [path.slice(1), 'image/png'];
  if (path === '/site.webmanifest') return [path.slice(1), 'application/manifest+json'];
  return null;
}
export function createApp(runtime: Runtime, token: string, origin = ORIGIN, ready = () => true) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', origin).pathname;
    try { trusted(req, token, path.startsWith('/api/') && path !== '/api/session', origin); }
    catch (error) { send(res, 403, { error: errorText(error) }); return; }
    if (!ready()) { send(res, 503, { error: 'Halo is restoring its local workspace. Retry shortly.' }); return; }
    try {
      if (req.method === 'GET') {
        if (path === '/api/session') { send(res, 200, { token, convex_url: process.env.HALO_CONVEX_URL ?? 'http://127.0.0.1:3210' }); return; }
        if (['/api/state', '/api/model', '/api/models'].includes(path)) {
          send(res, 200, await runtime.dispatch(path, {}, headerThread(req))); return;
        }
        if (path.startsWith('/api/artifacts/')) {
          send(res, 200, await runtime.resolve(headerThread(req)).screenshots.read(path.slice('/api/artifacts/'.length)), 'image/png'); return;
        }
        const file = asset(path);
        if (!file) { send(res, 404, { error: 'Not found.' }); return; }
        try { send(res, 200, await readFile(join(ROOT, 'web/dist', file[0])), file[1]); }
        catch { send(res, 503, { error: 'Web build missing. Run bash scripts/poc.sh.' }); }
      } else if (req.method === 'POST') {
        trusted(req, token, true, origin);
        const body = await jsonBody(req, path);
        send(res, 200, await runtime.dispatch(path, body, headerThread(req)));
      } else send(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      // Validation responses must never reflect submitted credentials or model payloads.
      send(res, 400, { error: error instanceof z.ZodError ? 'Invalid request fields.' : error instanceof SyntaxError ? 'Invalid JSON request.' : errorText(error).slice(0, 1000) });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
function headerThread(req: IncomingMessage) {
  const value = req.headers['x-halo-thread'];
  if (value !== undefined && typeof value !== 'string') throw new Error('Invalid thread ID.');
  return value ?? 'default';
}
export async function main() {
  const runtime = new Runtime();
  const token = await sessionToken(); let ready = false;
  const server = createApp(runtime, token, ORIGIN, () => ready);
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(8765, '127.0.0.1', done); });
  // A crashed model startup must not leave Convex permanently refusing new runs.
  await runtime.models.recoverGate().catch(() => {});
  await runtime.reconcile(token).catch(() => { console.error('Convex state reconciliation failed. Restart Halo after Convex becomes ready.'); });
  ready = true;
  console.log('Halo TypeScript executor: ' + ORIGIN + '. Models and VMs start only when requested.');
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    server.close(); server.closeIdleConnections();
    const deadline = setTimeout(() => { console.error('Cleanup timed out. Ownership records are retained for retry.'); process.exit(1); }, 55000);
    deadline.unref();
    await runtime.close(); server.closeAllConnections(); clearTimeout(deadline);
    // Native SDK/transpiler workers must not keep a closed app alive. Guest
    // cleanup has completed and late model results are fenced by Stop.
    process.exit(0);
  };
  process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch(error => { console.error(errorText(error)); process.exitCode = 1; });
