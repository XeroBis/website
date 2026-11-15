import { signal } from '@angular/core';

/** A tool's one action at a time: `busy` while it runs, `error` (an `error.` key) if it failed. */
export class Job {
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await work();
    } catch (e) {
      console.error(e);
      this.error.set('failed');
    } finally {
      this.busy.set(false);
    }
  }
}
