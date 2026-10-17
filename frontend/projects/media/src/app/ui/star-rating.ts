import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, LanguageService } from '@shared';

/** 0.5-5 stars with half stars; the value is stored as 1-10 (null = unrated). */
@Component({
  selector: 'ab-star-rating',
  imports: [DecimalPipe, Icon, TranslatePipe],
  template: `
    <div
      class="stars"
      role="group"
      [attr.aria-label]="'rating.label' | translate"
      (mouseleave)="hover.set(null)"
    >
      @for (star of stars; track star) {
        <span class="star">
          <ab-icon name="star" />
          <span class="fill" [style.width.%]="fill(star)"><ab-icon name="star" /></span>
          <button
            type="button"
            class="half left"
            [attr.aria-label]="'rating.stars' | translate: { count: star - 0.5 }"
            (mouseenter)="hover.set(star * 2 - 1)"
            (click)="pick(star * 2 - 1)"
          ></button>
          <button
            type="button"
            class="half right"
            [attr.aria-label]="'rating.stars' | translate: { count: star }"
            (mouseenter)="hover.set(star * 2)"
            (click)="pick(star * 2)"
          ></button>
        </span>
      }
    </div>
    <span class="value">
      {{
        shown()
          ? ('rating.outOf' | translate: { value: shown() / 2 | number: '1.0-1' : lang() })
          : ('rating.unrated' | translate)
      }}
    </span>
    @if (value() !== null) {
      <button type="button" class="btn ghost small" (click)="valueChange.emit(null)">
        {{ 'rating.clear' | translate }}
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .stars {
      display: flex;
      font-size: 30px;
      line-height: 1;
    }
    .star {
      position: relative;
      display: flex;
      color: var(--media-line);
      padding: 0 1px;
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      overflow: hidden;
      display: flex;
      padding-left: 1px;
      color: var(--media-star);
    }
    .half {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 50%;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      &.left {
        left: 0;
      }
      &.right {
        right: 0;
      }
    }
    .value {
      font-weight: 700;
      color: var(--ab-muted);
      min-width: 3ch;
    }
  `,
})
export class StarRating {
  readonly value = input<number | null>(null);
  readonly valueChange = output<number | null>();

  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly hover = signal<number | null>(null);
  protected readonly lang = inject(LanguageService).current;
  protected readonly shown = computed(() => this.hover() ?? this.value() ?? 0);

  protected fill(star: number): number {
    const halves = this.shown() - (star - 1) * 2;
    return Math.max(0, Math.min(2, halves)) * 50;
  }

  protected pick(value: number): void {
    // Tapping the current value clears it.
    this.valueChange.emit(value === this.value() ? null : value);
  }
}
