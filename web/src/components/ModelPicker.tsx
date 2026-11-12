import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { localRequest, commandResponse } from '../local-api';
import { Icon } from './Icon';

const modelState = z.object({
  selected_id: z.string(), phase: z.string(), ready: z.boolean(), managed: z.boolean(), error: z.string().nullable(),
  progress: z.object({ model_id: z.string(), bytes: z.number(), total: z.number() }).nullable(),
  models: z.array(z.object({ id: z.string(), name: z.string(), detail: z.string(), license: z.string(), provenance: z.string().optional(), note: z.string().optional(), installed: z.boolean(), source: z.string() })),
});
type State = z.infer<typeof modelState>;
export function ModelPicker({ token, busy, onReady }: { token: string; busy: boolean; onReady: (ready: boolean) => void }) {
  const [state, setState] = useState<State>(); const [open, setOpen] = useState(false); const [working, setWorking] = useState(false); const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null); const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => {
    let closed = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const next = await localRequest('/api/models', modelState, token); if (!closed) { setState(next); onReadyRef.current(next.ready); } }
      catch (failure) { if (!closed) setError((failure as Error).message); }
      if (!closed) timer = setTimeout(poll, 2000);
    }
    void poll(); return () => { closed = true; clearTimeout(timer); };
  }, [token]);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  async function change(path: string, id?: string) {
    setWorking(true); setError('');
    try { await localRequest(path, commandResponse, token, id ? { id } : {}); const next = await localRequest('/api/models', modelState, token); setState(next); onReadyRef.current(next.ready); }
    catch (failure) { setError((failure as Error).message); }
    finally { setWorking(false); }
  }
  const selected = state?.models.find(m => m.id === state.selected_id);
  const status = state?.phase === 'downloading' ? 'Downloading' : state?.phase === 'starting' ? 'Loading' : state?.ready ? 'Ready' : 'Off';
  const blocked = busy || working || ['downloading', 'starting', 'stopping'].includes(state?.phase ?? '');
  return <>
    <button className="model-picker-trigger" id="model-check" title={`Choose local model · ${selected?.name ?? 'Local model'} · ${status}`} aria-label="Choose local model" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <span className="model-icon" aria-hidden="true"><Icon name="cpu" /><span className={`dot ${state?.ready ? 'on' : 'off'}`} /></span><span id="model-status">{state?.phase === 'external' ? 'External model' : selected?.name ?? 'Local model'}<small>{status}</small></span><Icon name="chevron" />
    </button>
    <dialog ref={dialog} className="model-dialog bot-dialog" aria-labelledby="model-dialog-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <div className="dialog-heading"><div><h2 id="model-dialog-title">Choose your model</h2><p>Runs locally on your Mac.</p></div><button className="dialog-close" aria-label="Close model picker" onClick={() => setOpen(false)}><Icon name="close" /></button></div>
      <div className="model-dialog-body">
        <p className="model-intro">Choose a downloaded model to load it. All bots share one model. Download sizes include vision files; running needs extra memory.</p>
        {state?.models.map(item => <div className="model-choice" key={item.id} data-selected={state.selected_id === item.id && state.ready}>
          <div className="model-choice-copy"><strong>{item.name}{state.selected_id === item.id && state.ready ? <Icon name="check" /> : null}</strong><p>{item.detail}</p><small>{item.license}</small>{item.provenance ? <span className="model-provenance">{item.provenance}</span> : null}{item.note ? <p className="model-validation-note">{item.note}</p> : null}</div>
          <button className={item.installed ? 'secondary' : 'text-button'} disabled={blocked || state.phase === 'external' || (state.selected_id === item.id && state.ready)} onClick={() => void change(item.installed ? '/api/model/start' : '/api/model/download', item.id)}>
            <Icon name={item.installed ? 'play' : 'download'} />{state.selected_id === item.id && state.phase === 'starting' ? 'Loading…' : state.selected_id === item.id && state.ready ? 'In use' : item.installed ? 'Use model' : 'Download'}
          </button>
        </div>)}
        {state?.progress ? <div className="model-progress" role="status"><span>Downloading model · {(state.progress.bytes / 1e9).toFixed(1)} / {(state.progress.total / 1e9).toFixed(1)} GB</span><progress value={state.progress.bytes} max={state.progress.total} /></div> : null}
        {state?.phase === 'starting' ? <p role="status" className="model-intro">Loading the model into memory. This can take a few minutes.</p> : null}
        {state?.phase === 'external' ? <p className="model-intro">A model started outside Halo is connected. Stop it in its terminal to let Halo manage models.</p> : null}
        {error || state?.error ? <p role="alert" className="model-error">{error || state?.error}</p> : null}
      </div>
      <div className="dialog-footer"><span>8K context · Metal acceleration</span>{state?.managed || state?.progress ? <button className="secondary" disabled={busy || working} onClick={() => void change('/api/model/stop')}><Icon name="stop" />{state.progress ? 'Cancel download' : 'Unload model'}</button> : <span>Models stay off until you choose one.</span>}</div>
    </dialog>
  </>;
}
