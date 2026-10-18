import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { signal } from '@angular/core';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { DecklistConvertEntry } from '../../models/card.model';
import { ConvertService } from '../../services/convert.service';
import { ToastService } from '../../services/toast.service';
import { DecklistPreviewComponent } from '../shared/decklist-preview/decklist-preview.component';
@Component({
  selector: 'app-convert',
  imports: [FormsModule, TranslatePipe, DecklistPreviewComponent],
  templateUrl: './convert.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './convert.component.scss',
})
export class ConvertComponent {
  inputText = signal('');
  convertedText = signal('');
  detectedFormat = signal<'tcgplayer' | 'cardmarket' | null>(null);
  entries = signal<DecklistConvertEntry[]>([]);
  loading = signal(false);
  searched = signal(false);
  includeSets = signal(true);
  private readonly inputChanged = new Subject<string>();
  constructor(
    private readonly convertService: ConvertService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {
    this.inputChanged
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((text) => {
        this.convert(text);
      });
  }
  onInputChange(): void {
    this.inputChanged.next(this.inputText());
  }
  onIncludeSetsChange(): void {
    this.convert(this.inputText());
  }
  async pasteInput(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      this.inputText.set(text);
      this.onInputChange();
    } catch {
      this.toastService.show(this.translate.instant('convert.clipboardReadFailed'), 'error');
    }
  }
  async copyOutput(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.convertedText());
      this.toastService.show(this.translate.instant('convert.copiedToClipboard'));
    } catch {
      this.toastService.show(this.translate.instant('convert.clipboardCopyFailed'), 'error');
    }
  }
  private convert(text: string): void {
    if (!text.trim()) {
      this.convertedText.set('');
      this.detectedFormat.set(null);
      this.entries.set([]);
      this.searched.set(false);
      return;
    }
    this.loading.set(true);
    this.convertService.convertDecklist(text, this.includeSets()).subscribe({
      next: (res) => {
        this.detectedFormat.set(res.detected_format);
        this.convertedText.set(res.converted_text);
        this.entries.set(res.entries);
        this.searched.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
  get otherFormatLabel(): string {
    return this.detectedFormat()! === 'tcgplayer' ? 'Cardmarket' : 'TCGplayer / PTCGL';
  }
  get sourceFormatLabel(): string {
    return this.detectedFormat()! === 'tcgplayer' ? 'TCGplayer / PTCGL' : 'Cardmarket';
  }
  get showIncludeSetsToggle(): boolean {
    return this.detectedFormat()! === 'tcgplayer';
  }
}
