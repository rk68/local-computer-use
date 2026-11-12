import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OWNED } from './config.ts';
import { Desk } from './desk.ts';
export async function cleanup() {
  const threads = join(dirname(OWNED), 'threads');
  const files = existsSync(threads) ? await readdir(threads) : [];
  const markers = [...(existsSync(OWNED) ? [OWNED] : [])];
  let failed = false;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    if (!/^[a-z0-9]{20,64}\.json$/.test(file)) { console.error('Skipped an invalid thread ownership filename.'); failed = true; continue; }
    markers.push(join(threads, file));
  }
  for (const owned of markers) { const desk = new Desk({ owned }); await desk.stop(); if (desk.error) { console.error(desk.error); failed = true; } }
  console.log(markers.length ? 'Recorded guest cleanup finished. Image caches were retained.' : 'No Halo guest is recorded.');
  return failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await cleanup();
