import { Icon } from '@shared';

import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';

import { cycleVariantDisplayMode, VariantDisplayMode } from '../../../util/variant-display.util';

/** The "show variants" icon button shared by the set detail page and the
 * public shared-set page -- see documentation/features.md's "Show variants
 * toggle". Purely presentational: the caller resolves the
 * mode-specific label/title text itself (translated on set detail,
 * hardcoded English on the shared page, same as the rest of that page's
 * strings) and owns the actual `variantDisplayMode` state. */
@Component({
  selector: 'app-variant-mode-toggle',
  standalone: true,
  imports: [Icon],
  templateUrl: './variant-mode-toggle.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './variant-mode-toggle.component.scss',
})
export class VariantModeToggleComponent {
  @Input({ required: true }) mode!: VariantDisplayMode;
  @Input({ required: true }) label!: string;
  @Output() readonly modeChange = new EventEmitter<VariantDisplayMode>();

  cycle(): void {
    this.modeChange.emit(cycleVariantDisplayMode(this.mode));
  }
}
