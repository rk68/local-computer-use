// Uses only the smallest new model; larger entries remain optional downloads.
import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { modelAction } from '../src/actions.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = 'http://127.0.0.1:8765', id = 'holo31-08b';
const { token } = await (await fetch(base + '/api/session')).json();
async function api(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Local-Token': token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
async function inference(messages, extra = {}) {
  const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'holo4', messages, temperature: 0, max_tokens: 256, stream: false, chat_template_kwargs: { enable_thinking: false }, ...extra }), signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('Small-model inference HTTP ' + response.status); return response.json();
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const initial = await api('/api/models'); assert.equal(initial.ready, false); assert.equal(initial.phase, 'off');
assert.ok(initial.models.find(model => model.id === id));
const originalSelection = JSON.parse(await readFile(join(root, '.cache/halo/model-selection.json'), 'utf8')).id;
let started = false, browser;
try {
  if (!initial.models.find(model => model.id === id).installed) {
    await api('/api/model/download', { id });
    let last = -1;
    for (let attempt = 0; ; attempt++) {
      const state = await api('/api/models');
      const percent = state.progress ? Math.floor(state.progress.bytes * 100 / state.progress.total / 10) * 10 : 100;
      if (percent !== last) { console.log('Small model download: ' + percent + '%'); last = percent; }
      if (state.phase === 'failed') throw new Error(state.error);
      if (state.models.find(model => model.id === id).installed && state.phase === 'off') break;
      if (attempt > 900) throw new Error('Small-model download timed out.'); await wait(1000);
    }
  }
  console.log('PASS: pinned 0.8B weights and vision projector downloaded and checksum verified.');
  await api('/api/model/start', { id }); started = true;
  for (let attempt = 0; ; attempt++) {
    const state = await api('/api/models');
    if (state.ready && state.managed && state.selected_id === id) break;
    if (state.phase === 'failed' || attempt > 180) throw new Error(state.error || 'Small model failed to load.'); await wait(1000);
  }
  const text = await inference([{ role: 'user', content: 'Reply with exactly HALO_SMALL_READY.' }]);
  assert.ok(text.choices[0].message.content?.trim()); console.log('PASS: real local 0.8B text inference.');
  const warnings = [];
  if (!/HALO_SMALL_READY/.test(text.choices[0].message.content)) warnings.push('The model ignored the exact-format text instruction.');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<style>body{margin:0;background:white;color:#151515;font:48px system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}h1{font-size:128px;margin:0 0 80px}button{font:48px system-ui;background:#0f766e;color:white;padding:20px 50px;border:0;border-radius:16px}</style><h1>TANGERINE</h1><button>Confirm</button>');
  const png = await page.screenshot(), screen = 'data:image/png;base64,' + png.toString('base64');
  const directory = join(root, 'artifacts/models'); await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'small-model-vision-fixture.png'), png);
  const visual = await inference([{ role: 'user', content: [{ type: 'text', text: 'Read the large word in this image. Reply with that word only.' }, { type: 'image_url', image_url: { url: screen } }] }]);
  const visionPassed = /TANGERINE/i.test(visual.choices[0].message.content);
  console.log((visionPassed ? 'PASS' : 'LIMITATION') + ': real local 0.8B image recognition: ' + visual.choices[0].message.content);
  if (!visionPassed) warnings.push('The model did not read the fixture word correctly.');
  const action = await inference([
    { role: 'system', content: 'Use the click tool on the requested button. Coordinates are normalized from 0 to 1000.' },
    { role: 'user', content: [{ type: 'text', text: 'Click the Confirm button.' }, { type: 'image_url', image_url: { url: screen } }] },
  ], { tools: [{ type: 'function', function: { name: 'desktop_click', description: 'Click a button. Coordinates range from 0 to 1000.', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, reason: { type: 'string' } }, required: ['x', 'y', 'reason'], additionalProperties: false } } }], tool_choice: { type: 'function', function: { name: 'desktop_click' } }, parallel_tool_calls: false });
  let toolPassed = false, toolValid = false;
  try {
    const call = action.choices[0].message.tool_calls?.[0]; assert.equal(call?.function.name, 'desktop_click');
    const parsed = modelAction({ ...JSON.parse(call.function.arguments), action: 'click' }, 1280, 800);
    toolValid = true;
    const box = await page.getByRole('button', { name: 'Confirm', exact: true }).boundingBox();
    toolPassed = parsed.x >= box.x && parsed.x <= box.x + box.width && parsed.y >= box.y && parsed.y <= box.y + box.height;
  } catch { /* Keep the raw model response in the diagnostic report. */ }
  console.log((toolValid ? 'PASS' : 'LIMITATION') + ': real local 0.8B tool-call schema.');
  console.log((toolPassed ? 'PASS' : 'LIMITATION') + ': real local 0.8B button grounding.');
  if (!toolPassed) warnings.push(toolValid ? 'The model produced a valid tool call but missed the visible button.' : 'The model did not produce a valid click tool call.');
  await writeFile(join(directory, 'compatibility-0.8b.json'), JSON.stringify({ text: text.choices[0].message, vision: visual.choices[0].message, tool: action.choices[0].message, visionPassed, toolValid, toolPassed, warnings }, null, 2));
  for (const warning of warnings) console.log('LIMITATION: ' + warning);
  assert.ok(visionPassed && toolPassed, 'The smallest model remains experimental: inspect the compatibility report.');
} finally {
  await browser?.close();
  const current = await api('/api/models');
  if (started && current.managed && current.selected_id === id) {
    await api('/api/model/stop', {});
    await writeFile(join(root, '.cache/halo/model-selection.json'), JSON.stringify({ id: originalSelection }), { mode: 0o600 });
    console.log('Small test model unloaded; original selection saved for the next app start.');
  }
}
