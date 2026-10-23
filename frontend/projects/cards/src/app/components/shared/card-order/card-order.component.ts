import { Icon } from '@shared';

import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import {
  CARD_ORDER_FIELDS,
  CardOrder,
  CardOrderField,
  cardOrderFor,
} from '../../../util/card-order.util';

/** Sort select (number / name / quantity) plus a direction button, for the
 * set page and the purchase list page. The caller owns and stores the
 * order. */
@Component({
  selector: 'app-card-order',
  standalone: true,
  imports: [Icon, TranslatePipe],
  templateUrl: './card-order.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './card-order.component.scss',
})
export class CardOrderComponent {
  @Input({ required: true }) order!: CardOrder;
  @Output() readonly orderChange = new EventEmitter<CardOrder>();
  readonly fields = CARD_ORDER_FIELDS;

  setField(field: string): void {
    this.orderChange.emit(cardOrderFor(field as CardOrderField));
  }

  flip(): void {
    this.orderChange.emit({ ...this.order, descending: !this.order.descending });
  }
}
