import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
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
export class CardTileComponent implements OnChanges {
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

  /** Image requests a dropped connection killed so far (a failed <img>
   * never retries on its own, so the tile stayed blank until a reload). */
  private imageRetries = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['imageUrl']) {
      this.imageRetries = 0;
    }
  }

  /** Reloads a failed image up to twice, waiting a little longer each time. */
  onImageError(event: Event): void {
    if (this.imageRetries >= 2) {
      return;
    }
    this.imageRetries++;
    const img = event.target as HTMLImageElement;
    const url = this.imageUrl;
    setTimeout(() => {
      if (url === this.imageUrl) {
        img.src = url;
      }
    }, 1000 * this.imageRetries);
  }

  onClick(): void {
    if (this.clickable) {
      this.tileClick.emit();
    }
  }
}
