import { z } from 'zod';
import { websiteOrigin } from './credentials.ts';

const reason = z.string().min(1).max(1000);
const x = z.number().int().nonnegative();
const y = x;
const text = z.string().min(1).max(500).refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Control characters are not allowed.');
export const keys = ['enter', 'tab', 'shift+tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'space', 'ctrl+a', 'ctrl+l'] as const;
const fields = {
  navigate: { url: z.string().max(2048).refine(value => { try { websiteOrigin(value); return true; } catch { return false; } }) },
  click: { x, y }, type: { text }, replace_text: { x, y, text },
  key: { key: z.enum(keys) }, scroll: { x, y, direction: z.enum(['up', 'down']) },
};
const schemas = Object.entries(fields).map(([action, shape]) => z.strictObject({ action: z.literal(action), ...shape, reason }));
export type Action = { action: string; reason: string; x?: number; y?: number; text?: string; key?: string; direction?: string; url?: string };
export function validateAction(value: unknown, width: number, height: number): Action {
  const result = z.union(schemas as [typeof schemas[number], typeof schemas[number], ...typeof schemas[number][]]).parse(value) as Action;
  if (result.x !== undefined && (result.x >= width || result.y! >= height)) throw new Error('Coordinates must lie inside the guest screenshot.');
  return result;
}
export function modelAction(value: unknown, width: number, height: number): Action {
  if (value && typeof value === 'object' && 'action' in value && ['click', 'scroll', 'replace_text'].includes(String(value.action))) {
    const a = { ...value } as Record<string, unknown>;
    for (const [axis, size] of [['x', width], ['y', height]] as const) {
      const coordinate = a[axis];
      if (typeof coordinate !== 'number' || !Number.isInteger(coordinate) || coordinate < 0 || coordinate > 1000) throw new Error('Halo must return screenshot coordinates between 0 and 1000.');
      a[axis] = Math.min(size - 1, Math.floor(coordinate * size / 1000));
    }
    value = a;
  }
  return validateAction(value, width, height);
}
export const tools: { type: string; function: { name: string; description: string; parameters: object } }[] = Object.entries(fields).map(([action, shape]) => ({ type: 'function', function: {
  name: 'desktop_' + action, description: `Propose a ${action} action inside the guest for approval. Coordinates are normalized from 0 to 1000.`,
  parameters: z.toJSONSchema(z.strictObject({ ...shape, reason }), { unrepresentable: 'any' }),
} }));
for (const name of ['reply', 'blocked']) tools.push({ type: 'function', function: {
  name: 'desktop_' + name, description: name === 'reply' ? 'Answer or report completion for independent verification.' : 'Report an incomplete task or obstacle.',
  parameters: z.toJSONSchema(z.strictObject({ text: z.string().min(1).max(1500) })),
} });
export const loginTool = { type: 'function', function: { name: 'desktop_request_login', description: 'Ask for private login only when the user explicitly requests sign-in. Never ask for secrets in chat.', parameters: z.toJSONSchema(z.strictObject({ reason: z.string().min(1).max(500) })) } };
export const codeTool = { type: 'function', function: { name: 'desktop_request_code', description: 'Ask the user to privately enter a one-time verification code when an explicit sign-in task requires it. Never request codes in chat.', parameters: z.toJSONSchema(z.strictObject({ reason: z.string().min(1).max(500) })) } };
export function textAction(answer: string): unknown | null {
  try {
    const envelope = JSON.parse(answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'));
    if (Object.keys(envelope).length !== 1 || envelope.action?.type !== 'desktop_action') return null;
    const { type: _, ...action } = envelope.action;
    return { reason: 'Halo proposed this action for the sandbox.', ...action };
  } catch { return null; }
}

 tools.push({ type: 'function', function: { name: 'desktop_share_screenshot', description: 'Capture the current sandbox view and save an image in this conversation. Include a short caption. Use after selecting the requested visual result. This does not finish the task.', parameters: z.toJSONSchema(z.strictObject({ caption: z.string().min(1).max(500) })) } });
