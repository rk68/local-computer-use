import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { HoloAvatar } from '../agent/HoloAvatar';

export type Workspace = FunctionReturnType<typeof api.workspace.list>;
export type Thread = Workspace['threads'][number];
export type Bot = Workspace['bots'][number];
export type Navigation = { workspace: Workspace; thread: Thread; bot: Bot; select: (id: Id<'threads'>) => void };

export function BotThreads({ token, workspace, thread, select }: Navigation & { token: string }) {
  const createBot = useMutation(api.workspace.createBot);
  const updateBot = useMutation(api.workspace.updateBot);
  const [menuOpen, setMenuOpen] = useState(false);
  const createThread = useMutation(api.workspace.createConversation);
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<{ botId?: Id<'bots'>; botName?: string; editing?: boolean } | null>(null);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (form) dialog.current?.showModal(); else dialog.current?.close(); }, [form]);
  function open(next: NonNullable<typeof form>) { setName(next.editing ? next.botName ?? '' : ''); setInstructions(next.editing ? workspace.bots.find(b => b._id === next.botId)?.instructions ?? '' : ''); setError(''); setForm(next); }
  return <>
    <div className="bot-list-heading"><button className="mobile-thread-menu" aria-label="Switch bot or thread" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>Chats ⌄</button><span>YOUR BOTS</span><button className="icon-button" aria-label="Create bot" title="Create bot" onClick={() => open({})}>+</button></div>
    <nav className="bot-thread-list" data-open={menuOpen} aria-label="Bots and threads">
      {workspace.bots.map(bot => <section className="bot-group" key={bot._id}>
        <div className="bot-group-heading"><HoloAvatar small /><button className="bot-name-button" aria-label={`Edit ${bot.name}`} onClick={() => open({ botId: bot._id, botName: bot.name, editing: true })}>{bot.name}</button><button className="icon-button" aria-label={`New thread for ${bot.name}`} title="New thread" onClick={() => open({ botId: bot._id, botName: bot.name })}>+</button></div>
        {workspace.threads.filter(t => t.botId === bot._id).sort((a, b) => b.updatedAt - a.updatedAt).map(t => <button key={t._id} className="thread-link" aria-label={t.title} title={t.run ? `${t.title} · working` : t.title} aria-current={t._id === thread._id ? 'page' : undefined} onClick={() => { setMenuOpen(false); select(t._id); }}><span className="thread-line" aria-hidden="true">↳</span><span>{t.title}</span>{t.run ? <span className="thread-working" aria-label={t.run.status === 'cancelled' ? 'Stopping' : 'Working'} /> : null}</button>)}
      </section>)}
    </nav>
    <dialog ref={dialog} className="bot-dialog" aria-labelledby="bot-dialog-title" onCancel={event => { if (saving) event.preventDefault(); else setForm(null); }} onClose={() => setForm(null)}>
      <form onSubmit={event => {
        event.preventDefault(); setSaving(true); setError('');
        const task = form?.editing ? updateBot({ token, botId: form.botId!, name, instructions }).then(() => thread._id) : form?.botId ? createThread({ token, botId: form.botId, title: name }) : createBot({ token, name, instructions });
        void task.then(id => { setForm(null); select(id); }).catch(failure => setError(String(failure.message ?? failure))).finally(() => setSaving(false));
      }}>
        <div className="dialog-heading"><h2 id="bot-dialog-title">{form?.editing ? 'Bot settings' : form?.botId ? `New thread with ${form.botName}` : 'Meet your next bot'}</h2><button className="dialog-close" type="button" aria-label="Close new bot dialog" disabled={saving} onClick={() => setForm(null)}>×</button></div>
        <div className="bot-dialog-body"><label>{form?.botId && !form.editing ? 'Thread title' : 'Bot name'}<input key={String(form?.botId)} autoFocus value={name} maxLength={form?.botId && !form.editing ? 100 : 60} required onChange={event => setName(event.target.value)} placeholder={form?.botId ? 'A fresh start…' : 'Research partner…'} /></label>
        {!form?.botId || form.editing ? <label>Instructions <span>Optional</span><textarea value={instructions} maxLength={4000} rows={4} onChange={event => setInstructions(event.target.value)} placeholder="What should this bot focus on?" /></label> : null}
        <p>Each thread has its own history and desktop. Its sandbox starts only when you ask.</p>{error ? <p role="alert">{error}</p> : null}</div>
        <div className="dialog-footer">{form?.editing ? <button type="button" className="text-button" disabled={saving || workspace.bots.length < 2} onClick={() => {
          setSaving(true);
          void updateBot({ token, botId: form.botId!, name, instructions, archived: true }).then(() => setForm(null)).catch(failure => setError(String(failure.message ?? failure))).finally(() => setSaving(false));
        }}>Archive bot</button> : null}<button className="primary" disabled={saving || !name.trim()}>{saving ? 'Saving…' : form?.editing ? 'Save bot' : form?.botId ? 'Create thread' : 'Create bot'}</button></div>
      </form>
    </dialog>
  </>;
}
