import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { DecklistConvertEntry } from '../../../models/card.model';
import { CatalogService } from '../../../services/catalog.service';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';

/** Renders the per-line preview of a parsed decklist (matched entries with
 * image/name/set, an "unmatched" badge otherwise). Shared between the
 * Converter page and any "Paste a decklist" box (Create Deck modal, phantom
 * deck detail). */
@Component({
  selector: 'app-decklist-preview',
  imports: [TranslatePipe, CardDisplayNamePipe],
  templateUrl: './decklist-preview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './decklist-preview.component.scss',
})
export class DecklistPreviewComponent {
  @Input() entries: DecklistConvertEntry[] = [];

  constructor(private readonly catalogService: CatalogService) {}

  imageUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }

  get entriesQuantity(): number {
    return this.entries.reduce((sum, entry) => sum + entry.quantity, 0);
  }
}
