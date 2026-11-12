import { useEffect, useState } from 'react';
import { z } from 'zod';
import { localRequest } from '../local-api';
import type { SandboxState } from './state';

type Props = { request: NonNullable<SandboxState['credential_request']>; busy: boolean; token: string; threadId: string; command: (path: string, body?: object) => Promise<boolean> };

export function PrivateLogin({ request, busy, token, threadId, command }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [account, setAccount] = useState('');
  const [accounts, setAccounts] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const isCode = request.kind === 'code';
  useEffect(() => {
    let closed = false;
    if (!isCode) void localRequest('/api/accounts', z.object({ accounts: z.array(z.string()) }), token, { origin: request.origin }, threadId).then(value => {
      if (!closed) { setAccounts(value.accounts); setAccount(current => current || (value.accounts.includes('') ? '' : value.accounts[0] ?? '')); }
    }).catch(() => {});
    return () => { closed = true; };
  }, [token, threadId, request.origin, isCode]);
  async function submit(useSaved = false) {
    // This endpoint is separate from the chat transport. No secret becomes a message.
    const accepted = await command('/api/login', isCode ? { id: request.id, code } : { id: request.id, username, password, account, remember, use_saved: useSaved });
    setPassword(''); setCode('');
    if (accepted) setUsername('');
  }
  return <section className="private-login" aria-label="Private website login">
    <div className="proposal-label">{isCode ? 'PRIVATE VERIFICATION CODE' : 'PRIVATE LOGIN PREVIEW'} · {request.origin}</div>
    <p className="login-preview-note">Use a dummy account until live login tests pass.</p>
    <p>The account is filled only on this exact website. Halo receives a masked screenshot.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {isCode ? <><label>Verification code<input type="password" autoComplete="off" value={code} disabled={busy} minLength={4} maxLength={32} onChange={event => setCode(event.target.value)} required /></label><p>Used once for this website. Never saved to Keychain or chat.</p></> : <><label>Email or username<input autoComplete="off" value={username} disabled={busy} maxLength={320} onChange={event => setUsername(event.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="new-password" value={password} disabled={busy} maxLength={4096} onChange={event => setPassword(event.target.value)} required /></label>
      <label className="mode"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} />Save in macOS Keychain</label>
      {remember ? <label>Account label <small>Optional · for example, Work or Personal</small><input value={account} disabled={busy} maxLength={60} onChange={event => setAccount(event.target.value)} /></label> : accounts.length ? <label>Saved account<select value={account} disabled={busy} onChange={event => setAccount(event.target.value)}>{accounts.map(label => <option key={label} value={label}>{label || 'Default account'}</option>)}</select></label> : null}</>}
      <div className="approval-buttons"><button className="primary" disabled={busy}>{isCode ? 'Fill private code' : 'Fill private fields'}</button>{!isCode ? <button className="secondary" type="button" disabled={busy} onClick={() => void submit(true)}>Use saved account</button> : null}</div>
    </form>
    <div className="private-login-footer"><button className="text-button" disabled={busy} onClick={() => void command('/api/cancel-login', { id: request.id })}>Cancel</button>{!isCode ? <button className="text-button" disabled={busy} onClick={() => { void command('/api/forget-login', { origin: request.origin, account }).then(ok => { if (ok) { setAccounts(current => current.filter(value => value !== account)); setAccount(''); } }); }}>Forget selected account</button> : null}</div>
  </section>;
}
