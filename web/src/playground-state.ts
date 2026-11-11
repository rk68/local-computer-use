import { z } from 'zod';
import { transcriptMessage } from './conversation/messages';
import { sandboxState } from './sandbox/state';

export const playgroundState = sandboxState.extend({ messages: z.array(transcriptMessage) });
export type PlaygroundState = z.infer<typeof playgroundState>;
