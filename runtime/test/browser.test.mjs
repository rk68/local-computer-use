import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, secretMatcher, containsClosedShadow } from '../src/guest-browser.mjs';
test('public-address policy rejects private, local, mapped, and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '100.64.0.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '192.0.2.5', '224.1.2.3', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::', '64:ff9b::7f00:1', '64:ff9b::a00:1', '64:ff9b::1', '64:ff9b::192.168.1.1']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '64:ff9b::2347:b14f', '64:ff9b::8.8.8.8']) assert.equal(publicAddress(address), true, address);
});
test('secret matching handles case, regex characters, and invisible spacing', () => {
  assert.match('U\u200bS E\u200cR@EXAMPLE.TEST', secretMatcher('user@example.test'));
  assert.match('x.y+[a](b)*?', secretMatcher('x.y+[a](b)*?'));
});
test('closed shadow detection traverses nested CDP documents', () => {
  assert.equal(containsClosedShadow({ root: { children: [{ shadowRoots: [{ shadowRootType: 'closed' }] }] } }), true);
  assert.equal(containsClosedShadow({ shadowRootType: 'open' }), false);
});
