import { z } from 'zod';
import { Mutex } from './config.ts';

export function websiteOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter an HTTPS website address.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-zA-Z0-9.-]+$/.test(url.hostname)) throw new Error('Credentials require an HTTPS website on port 443, without URL credentials.');
  return 'https://' + url.hostname.toLowerCase().replace(/\.$/, '');
}
export const explicitLogin = (goal: string) => /\b(?:log\s+(?:me\s+)?in(?:to)?|sign\s+(?:me\s+)?in(?:to)?|authenticate)\b/i.test(goal.replace(/https?:\/\/\S+/gi, '')) || /^\s*(?:please\s+)?login\b/i.test(goal.replace(/https?:\/\/\S+/gi, ''));
export const credentials = z.strictObject({ username: z.string().min(1).max(320), password: z.string().min(1).max(4096) });
export type Credentials = z.infer<typeof credentials>;
export const accountLabel = z.string().trim().max(60).regex(/^[\p{L}\p{N} ._-]*$/u);
const vaultLock = new Mutex();
export interface Vault {
  save(origin: string, value: Credentials, label?: string): Promise<void>;
  read(origin: string, label?: string): Promise<Credentials>;
  delete(origin: string, label?: string): Promise<void>;
  list?(origin: string): Promise<string[]>;
}
export class CredentialVault implements Vault {
  private async entry(origin: string, label = '', index = false) {
    if (process.platform !== 'darwin') throw new Error('macOS Keychain is unavailable.');
    const { AsyncEntry } = await import('@napi-rs/keyring');
    const name = accountLabel.parse(label);
    return new AsyncEntry(index ? 'hololocal.web-login.accounts.v1' : 'hololocal.web-login.v1', websiteOrigin(origin) + (!index && name ? '#account=' + encodeURIComponent(name) : ''));
  }
  private async labels(origin: string) {
    const stored = await (await this.entry(origin, '', true)).getPassword();
    return stored ? z.array(accountLabel).max(24).parse(JSON.parse(stored)) : [];
  }
  async list(origin: string) {
    try {
      const labels = await this.labels(origin);
      // Keep the original single-account Keychain entries available after migration.
      if (!labels.includes('') && await (await this.entry(origin)).getPassword()) labels.unshift('');
      return labels;
    } catch { throw new Error('Could not read saved accounts from macOS Keychain.'); }
  }
  async save(origin: string, value: Credentials, label = '') {
    credentials.parse(value);
    try { await vaultLock.use(async () => {
      const name = accountLabel.parse(label); const labels = await this.labels(origin);
      if (!labels.includes(name) && labels.length >= 24) throw new Error();
      await (await this.entry(origin, name)).setPassword(JSON.stringify(value));
      await (await this.entry(origin, '', true)).setPassword(JSON.stringify([...new Set([...labels, name])]));
    }); }
    catch { throw new Error('Could not save the account in macOS Keychain.'); }
  }
  async read(origin: string, label = '') {
    try { return credentials.parse(JSON.parse((await (await this.entry(origin, label)).getPassword()) ?? 'null')); }
    catch { throw new Error('No saved account is available for this exact website.'); }
  }
  async delete(origin: string, label = '') {
    try { await vaultLock.use(async () => {
      const name = accountLabel.parse(label);
      await (await this.entry(origin, name)).deleteCredential();
      const labels = (await this.labels(origin)).filter(value => value !== name);
      const index = await this.entry(origin, '', true);
      if (labels.length) await index.setPassword(JSON.stringify(labels)); else await index.deleteCredential();
    }); }
    catch { throw new Error('Could not remove the saved account from macOS Keychain.'); }
  }
}
