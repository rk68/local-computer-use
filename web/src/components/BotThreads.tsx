import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { HoloAvatar } from '../agent/HoloAvatar';
import { AvatarPicker } from './AvatarPicker';
import { defaultAvatar, type AvatarAppearance } from '../../shared/avatar';
import { Icon } from './Icon';

export type Workspace = FunctionReturnType<typeof api.workspace.list>;
export type Thread = Workspace['threads'][number];
export type Bot = Workspace['bots'][number];
export type Navigation = { workspace: Workspace; thread: Thread; bot: Bot; select: (id: Id<'threads'>) => void };

export function BotThreads({ token, workspace, thread, select }: Navigation & { token: string }) {
  const createBot = useMutation(api.workspace.createBot);
  const updateBot = useMutation(api.workspace.updateBot);
  const updateThread = useMutation(api.workspace.updateThread);
  const threadDialog = useRef<HTMLDialogElement>(null);
  const [editingThread, setEditingThread] = useState<Thread | null>(null);
  const [threadTitle, setThreadTitle] = useState('');
  const [threadError, setThreadError] = useState('');
  const [threadSaving, setThreadSaving] = useState(false);
  useEffect(() => { if (editingThread) threadDialog.current?.showModal(); else threadDialog.current?.close(); }, [editingThread]);
  const [menuOpen, setMenuOpen] = useState(false);
  const createThread = useMutation(api.workspace.createConversation);
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<{ botId?: Id<'bots'>; botName?: string; editing?: boolean } | null>(null);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [avatar, setAvatar] = useState<AvatarAppearance>(defaultAvatar);
  const [memory, setMemory] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (form) dialog.current?.showModal(); else dialog.current?.close(); }, [form]);
  function open(next: NonNullable<typeof form>) { const existing = workspace.bots.find(b => b._id === next.botId); setAvatar(existing?.avatar ?? defaultAvatar); setName(next.editing ? next.botName ?? '' : ''); setInstructions(next.editing ? workspace.bots.find(b => b._id === next.botId)?.instructions ?? '' : ''); setMemory(next.editing ? workspace.bots.find(b => b._id === next.botId)?.memory ?? '' : ''); setError(''); setForm(next); }
  return <>
    <div className="bot-list-heading"><button className="mobile-thread-menu" aria-label="Switch bot or thread" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>Chats ⌄</button><span>YOUR BOTS</span><button className="icon-button" aria-label="Create bot" title="Create bot" onClick={() => open({})}><Icon name="plus" /></button></div>
    <nav className="bot-thread-list" data-open={menuOpen} aria-label="Bots and threads">
      {workspace.bots.map(bot => <section className="bot-group" key={bot._id}>
        <div className="bot-group-heading"><HoloAvatar small appearance={bot.avatar} /><button className="bot-name-button" aria-label={`Edit ${bot.name}`} onClick={() => open({ botId: bot._id, botName: bot.name, editing: true })}>{bot.name}</button><button className="icon-button" aria-label={`New thread for ${bot.name}`} title="New thread" onClick={() => open({ botId: bot._id, botName: bot.name })}><Icon name="plus" /></button></div>
        {workspace.threads.filter(t => t.botId === bot._id).sort((a, b) => b.updatedAt - a.updatedAt).map(t => <div className="thread-row" key={t._id}>
          <button className="thread-link" aria-label={t.title} title={t.run ? `${t.title} · working` : t.title} aria-current={t._id === thread._id ? 'page' : undefined} onClick={() => { setMenuOpen(false); select(t._id); }}><span className="thread-line" aria-hidden="true">↳</span><span>{t.title}</span>{t.run ? <span className="thread-working" aria-label={t.run.status === 'cancelled' ? 'Stopping' : 'Working'} /> : null}</button>
          <button className="thread-edit icon-button" aria-label={`Thread settings: ${t.title}`} onClick={() => { setEditingThread(t); setThreadTitle(t.title); setThreadError(''); }}><Icon name="edit" /></button>
        </div>)}
      </section>)}
      {workspace.archivedBots.length || workspace.archivedThreads.length ? <details className="archived-items"><summary><Icon name="archive" /> Archived</summary>
        {workspace.archivedBots.map(bot => <div className="archived-row" key={bot._id}><span>{bot.name}</span><button className="text-button" onClick={() => { void updateBot({ token, botId: bot._id, name: bot.name, instructions: bot.instructions, archived: false }).catch(failure => { setError(String(failure.message ?? failure)); open({}); }); }}>Restore bot</button></div>)}
        {workspace.archivedThreads.map(t => <div className="archived-row" key={t._id}><span>{t.title}</span><button className="text-button" onClick={() => { void updateThread({ token, threadId: t._id, title: t.title, archived: false }).then(() => select(t._id)).catch(failure => { setThreadError(String(failure.message ?? failure)); }); }}>Restore thread</button></div>)}
      </details> : null}
    </nav>
    <dialog ref={dialog} className="bot-dialog" aria-labelledby="bot-dialog-title" onCancel={event => { if (saving) event.preventDefault(); else setForm(null); }} onClose={() => setForm(null)}>
      <form onSubmit={event => {
        event.preventDefault(); setSaving(true); setError('');
        const task = form?.editing ? updateBot({ token, botId: form.botId!, name, instructions, memory, avatar }).then(() => thread._id) : form?.botId ? createThread({ token, botId: form.botId, title: name }) : createBot({ token, name, instructions, avatar });
        void task.then(id => { setForm(null); select(id); }).catch(failure => setError(String(failure.message ?? failure))).finally(() => setSaving(false));
      }}>
        <div className="dialog-heading"><h2 id="bot-dialog-title">{form?.editing ? 'Bot settings' : form?.botId ? `New thread with ${form.botName}` : 'Meet your next bot'}</h2><button className="dialog-close" type="button" aria-label="Close new bot dialog" disabled={saving} onClick={() => setForm(null)}><Icon name="close" /></button></div>
        <div className="bot-dialog-body"><label>{form?.botId && !form.editing ? 'Thread title' : 'Bot name'}<input key={String(form?.botId)} autoFocus value={name} maxLength={form?.botId && !form.editing ? 100 : 60} required onChange={event => setName(event.target.value)} placeholder={form?.botId && !form.editing ? 'A fresh start…' : 'Give your Halo a name…'} /></label>
        {form && (!form.botId || form.editing) ? <AvatarPicker value={avatar} onChange={setAvatar} name={name} disabled={saving} /> : null}
        {!form?.botId || form.editing ? <label>Instructions <span>Optional</span><textarea value={instructions} maxLength={4000} rows={4} onChange={event => setInstructions(event.target.value)} placeholder="What should this bot focus on?" /></label> : null}
        {form?.editing ? <label>Saved memory <span>Shared only with this bot’s threads</span><textarea value={memory} maxLength={2000} rows={3} onChange={event => setMemory(event.target.value)} placeholder="Preferences or facts to remember. Keep passwords in private login." /></label> : null}
        <p>Each thread has its own history and desktop. Its sandbox starts only when you ask.</p>{error ? <p role="alert">{error}</p> : null}</div>
        <div className="dialog-footer">{form?.editing ? <button type="button" className="text-button" disabled={saving || workspace.bots.length < 2} onClick={() => {
          setSaving(true);
          void updateBot({ token, botId: form.botId!, name, instructions, archived: true }).then(() => setForm(null)).catch(failure => setError(String(failure.message ?? failure))).finally(() => setSaving(false));
        }}>Archive bot</button> : null}<button className="primary" disabled={saving || !name.trim()}>{saving ? 'Saving…' : form?.editing ? 'Save bot' : form?.botId ? 'Create thread' : 'Create bot'}</button></div>
      </form>
    </dialog>
    <dialog ref={threadDialog} className="bot-dialog" aria-labelledby="thread-settings-title" onCancel={event => { if (threadSaving) event.preventDefault(); else setEditingThread(null); }} onClose={() => setEditingThread(null)}>
      <form onSubmit={event => { event.preventDefault(); if (!editingThread) return; setThreadSaving(true); setThreadError(''); void updateThread({ token, threadId: editingThread._id, title: threadTitle }).then(() => setEditingThread(null)).catch(failure => setThreadError(String(failure.message ?? failure))).finally(() => setThreadSaving(false)); }}>
        <div className="dialog-heading"><h2 id="thread-settings-title">Thread settings</h2><button type="button" className="dialog-close" aria-label="Close thread settings" disabled={threadSaving} onClick={() => setEditingThread(null)}><Icon name="close" /></button></div>
        <div className="bot-dialog-body"><label>Thread title<input autoFocus value={threadTitle} maxLength={100} required onChange={event => setThreadTitle(event.target.value)} /></label><p>Archived threads keep their history. Stop the sandbox before archiving.</p>{threadError ? <p role="alert">{threadError}</p> : null}</div>
        <div className="dialog-footer"><button className="text-button" type="button" disabled={threadSaving || !!editingThread?.activeRunId || !!editingThread?.sandbox} onClick={() => { if (!editingThread) return; setThreadSaving(true); setThreadError(''); void updateThread({ token, threadId: editingThread._id, title: threadTitle, archived: true }).then(() => setEditingThread(null)).catch(failure => setThreadError(String(failure.message ?? failure))).finally(() => setThreadSaving(false)); }}><Icon name="archive" /> Archive thread</button><button className="primary" disabled={threadSaving || !threadTitle.trim()}>{threadSaving ? 'Saving…' : 'Save thread'}</button></div>
      </form>
    </dialog>
  </>;
}
