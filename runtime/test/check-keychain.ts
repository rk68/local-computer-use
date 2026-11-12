// Writes and deletes only a uniquely named dummy entry, never a real account.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CredentialVault } from '../src/credentials.ts';
const vault = new CredentialVault();
const origin = 'https://halo-qa-' + randomUUID() + '.example.test';
const value = { username: 'dummy-account', password: randomUUID() };
try {
  await vault.save(origin, value); assert.deepEqual(await vault.read(origin), value);
  const work = { username: 'dummy-work-account', password: randomUUID() };
  await vault.save(origin, work, 'Work');
  assert.deepEqual(await vault.read(origin, 'Work'), work);
  assert.deepEqual(await vault.read(origin), value);
  assert.deepEqual((await vault.list(origin)).sort(), ['', 'Work']);
  await vault.delete(origin, 'Work'); assert.deepEqual(await vault.read(origin), value);
  await assert.rejects(vault.read(origin.replace('halo-qa-', 'halo-other-')), /No saved account/);
  await vault.delete(origin); await assert.rejects(vault.read(origin), /No saved account/);
  assert.deepEqual(await vault.list(origin), []);
  console.log('PASS: native macOS Keychain default/named dummy accounts, independent values, exact-origin scoping, selected deletion, and index cleanup.');
} finally { await vault.delete(origin, 'Work').catch(() => {}); await vault.delete(origin).catch(() => {}); }
