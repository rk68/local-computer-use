import { z } from 'zod';

const apiError = z.object({ error: z.string() });
export const sessionResponse = z.object({ token: z.string().min(1) });
export const commandResponse = z.object({ accepted: z.literal(true) });
export const modelResponse = z.object({ ok: z.boolean(), error: z.string().optional() });

export async function localRequest<T>(path: string, schema: z.ZodType<T>, token = '', body?: object): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Local-Token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const failure = apiError.safeParse(value);
    throw new Error(failure.success ? failure.data.error : `Request failed (${response.status}).`);
  }
  return schema.parse(value);
}
