import { useState } from 'react';
import type { SandboxState } from './state';

type Props = { request: NonNullable<SandboxState['credential_request']>; busy: boolean; command: (path: string, body?: object) => Promise<boolean> };

export function PrivateLogin({ request, busy, command }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  async function submit(useSaved = false) {
    // This endpoint is separate from the chat transport. No secret becomes a message.
    const accepted = await command('/api/login', { id: request.id, username, password, remember, use_saved: useSaved });
    setPassword('');
    if (accepted) setUsername('');
  }
  return <section className="private-login" aria-label="Private website login">
    <div className="proposal-label">PRIVATE LOGIN PREVIEW · {request.origin}</div>
    <p className="login-preview-note">Use a dummy account until live login tests pass.</p>
    <p>The account is filled only on this exact website. Halo receives a masked screenshot.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>Email or username<input autoComplete="off" value={username} disabled={busy} maxLength={320} onChange={event => setUsername(event.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="new-password" value={password} disabled={busy} maxLength={4096} onChange={event => setPassword(event.target.value)} required /></label>
      <label className="mode"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} />Save in macOS Keychain</label>
      <div className="approval-buttons"><button className="primary" disabled={busy}>Fill private fields</button><button className="secondary" type="button" disabled={busy} onClick={() => void submit(true)}>Use saved account</button></div>
    </form>
    <div className="private-login-footer"><button className="text-button" disabled={busy} onClick={() => void command('/api/cancel-login', { id: request.id })}>Cancel</button><button className="text-button" disabled={busy} onClick={() => void command('/api/forget-login', { origin: request.origin })}>Forget saved account</button></div>
  </section>;
}
