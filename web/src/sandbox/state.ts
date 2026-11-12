import { z } from 'zod';

const target = { x: z.number().int().nonnegative(), y: z.number().int().nonnegative() };
const reason = z.string();
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string(), reason }),
  z.object({ action: z.literal('click'), ...target, reason }),
  z.object({ action: z.literal('type'), text: z.string(), reason }),
  z.object({ action: z.literal('replace_text'), ...target, text: z.string(), reason }),
  z.object({ action: z.literal('key'), key: z.string(), reason }),
  z.object({ action: z.literal('scroll'), ...target, direction: z.enum(['up', 'down']), reason }),
]);

export const sandboxState = z.object({
  phase: z.string(),
  busy: z.boolean(),
  error: z.string().nullable(),
  sandbox: z.boolean(),
  sandbox_id: z.string().nullable(),
  events: z.array(z.object({ time: z.string(), text: z.string() })),
  pending: z.object({ id: z.string(), action }).nullable(),
  screen: z.string().startsWith('data:image/png;base64,').nullable(),
  actions: z.number().int().nonnegative(),
  max_actions: z.number().int().positive(),
  approve_all: z.boolean(),
  network: z.boolean(),
  browser_origin: z.string().nullable(),
  credential_request: z.object({ id: z.string(), origin: z.string(), reason: z.string(), kind: z.enum(['password', 'code']).optional() }).nullable(),
  task: z.object({ goal: z.string(), steps: z.number().int().nonnegative() }).nullable(),
});

export type SandboxState = z.infer<typeof sandboxState>;
export type SandboxAction = z.infer<typeof action>;

export function actionDescription(proposal: SandboxAction): string {
  switch (proposal.action) {
    case 'navigate':
      return `Open ${proposal.url} in the guest browser.`;
    case 'replace_text':
      return `Replace the field at (${proposal.x}, ${proposal.y}) with ${JSON.stringify(proposal.text)}.`;
    case 'click':
      return `Click at (${proposal.x}, ${proposal.y}).`;
    case 'type':
      return `Type ${JSON.stringify(proposal.text)}.`;
    case 'key':
      return `Press ${proposal.key}.`;
    case 'scroll':
      return `Scroll ${proposal.direction} at (${proposal.x}, ${proposal.y}).`;
  }
}
