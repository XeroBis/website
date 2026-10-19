import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** The chrome shared by every card grid tile in the app (set detail's
 * standard/exploded-variant grids and the public shared-set page's
 * matching grids): thumbnail, owned/reverse badges, name/number line, and a
 * projected slot for whatever controls that specific grid needs (quantity
 * steppers on set detail, nothing on the read-only shared page) -- see
 * documentation/features.md's "Show variants toggle". Kept presentational so
 * each page still owns its own data/editing logic. */
@Component({
  selector: 'app-card-tile',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './card-tile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './card-tile.component.scss',
})
export class CardTileComponent {
  @Input({ required: true }) imageUrl!: string;
  @Input({ required: true }) alt!: string;
  @Input({ required: true }) title!: string;
  @Input({ required: true }) subLabel!: string;
  @Input() ownedQty = 0;
  @Input() reverseQty = 0;
  @Input() notOwned = false;
  /** Copies on incoming purchase lists: an "Incoming ×N" badge. */
  @Input() incomingQty = 0;
  /** Printed-style card number (e.g. "012/191") chipped onto the image's
   * top-left corner -- omitted when empty. `secretNumber` highlights a
   * number past the set's official count (see features.md's "Sets"). */
  @Input() numberBadge = '';
  @Input() secretNumber = false;
  @Input() clickable = true;
  @Output() readonly tileClick = new EventEmitter<void>();

  onClick(): void {
    if (this.clickable) {
      this.tileClick.emit();
    }
  }
}
