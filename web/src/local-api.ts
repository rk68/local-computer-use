import { z } from 'zod';

export const desktopCommandPath = z.enum(['/api/start', '/api/stop', '/api/refresh', '/api/approve', '/api/reject', '/api/approval-mode', '/api/cancel-login']);
export const desktopCommandBody = z.object({ id: z.string().optional(), network: z.boolean().optional(), enabled: z.boolean().optional() }).strict();

const apiError = z.object({ error: z.string() });
export const sessionResponse = z.object({ token: z.string().min(1), convex_url: z.string().optional() });
export const commandResponse = z.object({ accepted: z.literal(true) });
export const modelResponse = z.object({ ok: z.boolean(), error: z.string().optional() });

export async function localRequest<T>(path: string, schema: z.ZodType<T>, token = '', body?: object, threadId?: string): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Local-Token': token, ...(threadId ? { 'X-Halo-Thread': threadId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const failure = apiError.safeParse(value);
    throw new Error(failure.success ? failure.data.error : `Request failed (${response.status}).`);
  }
  return schema.parse(value);
}
