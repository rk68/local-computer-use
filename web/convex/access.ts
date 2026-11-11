import { ConvexError } from 'convex/values';
export function authorize(token: string) {
  const expected = process.env.HALO_SESSION_TOKEN;
  if (!expected || token !== expected) throw new ConvexError('Local session expired. Reload Halo.');
}
export function requiredText(value: string, name: string, limit: number) {
  const clean = value.trim();
  if (!clean || clean.length > limit) throw new ConvexError(`${name} must contain 1–${limit} characters.`);
  return clean;
}
