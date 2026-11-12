import type { AvatarAppearance } from '../../shared/avatar';
import { useMemo } from 'react';
import { HoloAvatar } from '../agent/HoloAvatar';
import { Icon } from '../components/Icon';
import { ScreenshotCard, type SavedScreenshot } from './ScreenshotCard';

type Message = { id: string; order?: number; role: string; parts: { type: string; text?: string }[] };
const textOf = (message: Message) => message.parts.flatMap(part => part.type === 'text' ? [part.text ?? ''] : []).join('\n');
function activity(message: Message) {
  const text = textOf(message);
  return message.role !== 'user' && (/^(Running the next action in the sandbox: |An action is ready for your approval\.$)/.test(text) || (message.role === 'system' && text === 'Action sent to the guest. Inspecting the new screenshot.'));
}
export function ConversationHistory({ messages, images, token, threadId, botName, avatar }: { messages: Message[]; images: SavedScreenshot[]; token: string; threadId: string; botName: string; avatar?: AvatarAppearance }) {
  const displayMessages = useMemo(() => messages.flatMap(message => {
    const parts = message.parts.filter(part => part.type === 'text');
    // Split SDK-combined progress and answer parts before grouping activity.
    if (message.role !== 'assistant' || parts.length < 2 || !parts.some(part => activity({ ...message, parts: [part] }))) return [message];
    return parts.map((part, index) => ({ ...message, id: `${message.id}:${index}`, parts: [part] }));
  }), [messages]);
  const entries = useMemo(() => {
    const grouped: { messages: Message[]; activity: boolean }[] = [];
    for (const message of displayMessages) {
      const isActivity = activity(message), previous = grouped.at(-1);
      if (isActivity && previous?.activity) previous.messages.push(message);
      else grouped.push({ messages: [message], activity: isActivity });
    }
    return grouped;
  }, [displayMessages]);
  const byMessage = useMemo(() => {
    const map = new Map<string, SavedScreenshot[]>();
    for (const image of images) {
      // The chat SDK can merge consecutive assistant messages into one UI
      // message. Bind that case by the saved order and exact caption part.
      const owner = displayMessages.find(message => message.id === image.messageId) ?? displayMessages.find(message => message.role === 'assistant' && (image.order === undefined || message.order === image.order) && message.parts.some(part => part.type === 'text' && part.text === image.caption));
      if (owner) map.set(owner.id, [...(map.get(owner.id) ?? []), image]);
    }
    return map;
  }, [images, displayMessages]);
  return entries.map(entry => {
    const first = entry.messages[0];
    if (entry.activity) {
      const steps = entry.messages.filter(message => message.role === 'assistant');
      return <details className="task-activity" key={first.id}><summary><Icon name="activity" /><span>Sandbox activity</span><small>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</small><Icon name="chevron" /></summary>
        <ol>{entry.messages.map(message => <li key={message.id} data-receipt={message.role === 'system'}>{message.role === 'system' ? <Icon name="check" /> : <Icon name="arrow" />}<span>{textOf(message).replace(/^Running the next action in the sandbox: /, '').replace('Action sent to the guest. Inspecting the new screenshot.', 'Action sent · screen updated')}</span></li>)}</ol>
      </details>;
    }
    const screenshots = byMessage.get(first.id) ?? [];
    return <div className={`message-row ${first.role}`} key={first.id}>
      {first.role === 'assistant' ? <HoloAvatar appearance={avatar} /> : null}
      <div className={`message ${first.role}`}><div className="message-label">{first.role === 'assistant' ? botName : first.role === 'user' ? 'You' : 'Playground'}</div>
        {first.parts.map((part, index) => part.type === 'text' ? <p key={index}>{part.text}</p> : null)}
        {screenshots.map(image => <ScreenshotCard key={image.id} image={image} token={token} threadId={threadId} />)}
      </div>
    </div>;
  });
}
