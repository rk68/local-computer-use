// Thread history can contain desktop status records with role "system".
// Those are transcript events, not model instructions. Keep them in storage
// and UI history, but leave them out of the text model's conversation.
export function chatContext<T extends { role: string; content: unknown }>(messages: readonly T[], budget = 12000): T[] {
  const recent: T[] = [];
  for (const message of [...messages].reverse()) {
    if (message.role === 'system') continue;
    const size = JSON.stringify(message.content).length;
    if (size > budget && recent.length) break;
    recent.push(message); budget -= size;
  }
  return recent.reverse();
}
