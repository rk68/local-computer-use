import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatContext } from '../../web/shared/chat-context.ts';

test('desktop status records cannot become interleaved system instructions in text chat', () => {
  const history = [
    { role: 'user', content: 'Click Save.' },
    { role: 'assistant', content: 'Running the next action in the sandbox: Save the form' },
    { role: 'system', content: 'Action sent to the guest. Inspecting the new screenshot.' },
    { role: 'assistant', content: 'The form is saved.' },
    { role: 'user', content: 'Hello' },
  ];
  const copy = structuredClone(history);
  assert.deepEqual(chatContext(history), history.filter(message => message.role !== 'system'));
  assert.deepEqual(history, copy, 'Persistent history must remain intact.');
  assert.equal(chatContext(history).at(-1)?.content, 'Hello');
});
test('chat context keeps recent turns in order and applies its budget after removing status records', () => {
  const history = [
    { role: 'user', content: 'old request'.repeat(20) },
    { role: 'system', content: 'status'.repeat(200) },
    { role: 'assistant', content: 'Hi' },
    { role: 'user', content: 'Hello' },
  ];
  assert.deepEqual(chatContext(history, 20), history.slice(-2));
  const longPrompt = [{ role: 'user', content: 'x'.repeat(100) }];
  assert.deepEqual(chatContext(longPrompt, 10), longPrompt);
});
