import { httpErrorMessage } from '@shared';
import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error';

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  private nextId = 0;

  show(text: unknown, kind: ToastKind = 'success', durationMs = 4000): void {
    const toast: Toast = {
      id: this.nextId++,
      text: typeof text === 'string' ? text : httpErrorMessage({ error: { detail: text } }),
      kind,
    };
    this.toasts.set([...this.toasts(), toast]);
    setTimeout(() => this.dismiss(toast.id), durationMs);
  }

  dismiss(id: number): void {
    this.toasts.set(this.toasts().filter((t) => t.id !== id));
  }
}
