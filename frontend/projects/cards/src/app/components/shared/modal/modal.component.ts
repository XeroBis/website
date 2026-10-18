import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-modal',
  imports: [TranslatePipe],
  templateUrl: './modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './modal.component.scss',
})
export class ModalComponent implements OnInit, OnDestroy {
  @Input() title = '';
  @Input() wide = false;
  @Input() fullscreen = false;
  @Output() closed = new EventEmitter<void>();

  private previousBodyOverflow = '';

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  ngOnInit(): void {
    // Modals are mounted/unmounted via *ngIf at the call sites, so this
    // lifecycle maps 1:1 to open/close -- without it, the page behind a
    // sheet-style modal keeps scrolling on mobile.
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    document.body.style.overflow = this.previousBodyOverflow;
  }

  close(): void {
    this.closed.emit();
  }
}
