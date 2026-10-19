import { signal } from '@angular/core';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
export interface SearchableSelectItem {
  id: number;
  label: string;
}
@Component({
  selector: 'app-searchable-select',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './searchable-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './searchable-select.component.scss',
})
export class SearchableSelectComponent implements OnChanges {
  @Input()
  items: SearchableSelectItem[] = [];
  @Input()
  value: number | null = null;
  @Input()
  placeholder = 'Choose...';
  @Output()
  valueChange = new EventEmitter<number | null>();
  query = signal('');
  open = signal(false);
  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && !this.open()) {
      this.query.set(this.selectedLabel);
    }
  }
  get selectedLabel(): string {
    return this.items.find((item) => item.id === this.value)?.label ?? '';
  }
  get filteredItems(): SearchableSelectItem[] {
    const term = this.query().trim().toLowerCase();
    if (!term || term === this.selectedLabel.toLowerCase()) {
      return this.items;
    }
    return this.items.filter((item) => item.label.toLowerCase().includes(term));
  }
  onFocus(): void {
    this.open.set(true);
    this.query.set('');
  }
  onQueryChange(value: string): void {
    this.query.set(value);
    this.open.set(true);
  }
  select(item: SearchableSelectItem): void {
    this.query.set(item.label);
    this.open.set(false);
    if (item.id !== this.value) {
      this.valueChange.emit(item.id);
    }
  }
  // pointerdown, not click: a modal panel stops its clicks from reaching the
  // document, which would keep the list open on a click elsewhere in it.
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
      this.query.set(this.selectedLabel);
    }
  }
}
