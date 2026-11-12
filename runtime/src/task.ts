export class DesktopTask {
  steps = 0;
  screenshots = 0;
  verificationRetries = 0;
  executed_steps: Record<string, unknown>[] = [];
  private recent: string[] = [];
  constructor(readonly goal: string, readonly epoch: number) {}
  record(fingerprint: string, receipt: Record<string, unknown>, screenDigest: string) {
    this.executed_steps.push(receipt);
    this.recent.push(JSON.stringify([fingerprint, screenDigest]));
    this.recent = this.recent.slice(-6);
    const last = this.recent.slice(-3);
    if (last.length === 3 && new Set(last).size === 1) throw new Error('The same action repeated three times. Task paused; inspect the screenshot.');
    if (this.recent.length === 6 && this.recent[0] === this.recent[2] && this.recent[2] === this.recent[4] && this.recent[1] === this.recent[3] && this.recent[3] === this.recent[5]) throw new Error('The same action cycle repeated three times. Task paused; inspect the screenshot.');
  }
}
