import {
  Component,
  ElementRef,
  Injectable,
  afterRenderEffect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

/** Translation keys (and their params) for one dialog. */
export interface DialogOptions {
  title: string;
  message?: string;
  params?: Record<string, unknown>;
  /** The confirm button's label. */
  confirm: string;
  /** Red confirm button, for deletions. */
  danger?: boolean;
}

export interface PromptOptions extends DialogOptions {
  /** The text field's label. */
  label: string;
  value?: string;
}

interface OpenDialog extends DialogOptions {
  input: { label: string } | null;
  resolve: (value: string | true | null) => void;
}

/**
 * The app's confirm and prompt dialogs, in place of the browser's
 * `confirm()` / `prompt()`. Shown by the one `<ab-dialogs>` in the app shell.
 */
@Injectable({ providedIn: 'root' })
export class Dialogs {
  readonly current = signal<OpenDialog | null>(null);
  /** The prompt's text field. */
  readonly value = signal('');

  /** True when confirmed; false on Cancel, Escape or a click outside. */
  async confirm(options: DialogOptions): Promise<boolean> {
    return (await this.open(options, null)) === true;
  }

  /** The trimmed text, or null when cancelled or left empty. */
  async prompt(options: PromptOptions): Promise<string | null> {
    this.value.set(options.value ?? '');
    const result = await this.open(options, { label: options.label });
    return typeof result === 'string' && result.trim() ? result.trim() : null;
  }

  close(result: string | true | null): void {
    const open = this.current();
    this.current.set(null);
    open?.resolve(result);
  }

  private open(options: DialogOptions, input: OpenDialog['input']): Promise<string | true | null> {
    // A new dialog cancels one still open.
    this.close(null);
    return new Promise((resolve) => this.current.set({ ...options, input, resolve }));
  }
}

/** Renders the open dialog as a native modal `<dialog>` (focus trap, Escape). */
@Component({
  selector: 'ab-dialogs',
  imports: [FormsModule, TranslatePipe],
  template: `
    <dialog
      #dialog
      class="dialog"
      [attr.aria-labelledby]="'dialog-title'"
      (cancel)="$event.preventDefault(); dialogs.close(null)"
      (click)="backdrop($event)"
    >
      @if (dialogs.current(); as d) {
        <form (submit)="$event.preventDefault(); submit()">
          <h2 id="dialog-title" class="dialog-title">{{ d.title | translate: d.params }}</h2>
          @if (d.message) {
            <p class="dialog-message">{{ d.message | translate: d.params }}</p>
          }
          @if (d.input; as input) {
            <label class="dialog-field">
              <span class="label">{{ input.label | translate }}</span>
              <input
                class="field"
                name="value"
                autocomplete="off"
                autofocus
                [ngModel]="dialogs.value()"
                (ngModelChange)="dialogs.value.set($event)"
              />
            </label>
          }
          <div class="dialog-actions">
            <button
              type="button"
              class="btn ghost"
              data-testid="dialog-cancel"
              [attr.autofocus]="d.input ? null : ''"
              (click)="dialogs.close(null)"
            >
              {{ 'dialog.cancel' | translate }}
            </button>
            <button
              type="submit"
              class="btn"
              data-testid="dialog-confirm"
              [class.danger-solid]="d.danger"
              [disabled]="d.input !== null && !dialogs.value().trim()"
            >
              {{ d.confirm | translate }}
            </button>
          </div>
        </form>
      }
    </dialog>
  `,
})
export class DialogHost {
  protected readonly dialogs = inject(Dialogs);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    afterRenderEffect(() => {
      const open = this.dialogs.current() !== null;
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        if (el.showModal) el.showModal();
        else el.setAttribute('open', '');
      } else if (!open && el.open) {
        if (el.close) el.close();
        else el.removeAttribute('open');
      }
    });
  }

  protected submit(): void {
    const d = this.dialogs.current();
    if (!d) return;
    this.dialogs.close(d.input ? this.dialogs.value() : true);
  }

  /** A click on the backdrop (the `<dialog>` itself, outside its form) cancels. */
  protected backdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialogs.close(null);
  }
}
