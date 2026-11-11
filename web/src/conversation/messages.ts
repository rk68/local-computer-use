import { z } from 'zod';

export const transcriptMessage = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string(),
});
