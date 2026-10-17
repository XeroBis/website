import { Component, computed, inject, input, signal } from '@angular/core';

import { Icon, LanguageService } from '@shared';

import { TYPE_ICON, hue } from '../media/labels';
import { LocalTitlePipe } from '../media/local-title';
import { MediaApi } from '../media/media-api';
import { MediaItem } from '../media/models';

/**
 * 2:3 poster: the cached cover, or a placeholder in the item's own hue.
 * An attribute, so the host can be a link: `<a abPoster [item]="…" routerLink="…">`.
 */
@Component({
  selector: '[abPoster]',
  imports: [Icon, LocalTitlePipe],
  host: { class: 'poster', '[attr.data-type]': 'item().type', '[style.--h]': 'hue()' },
  template: `
    @if (item().has_cover && !failed()) {
      <img [src]="coverUrl()" alt="" loading="lazy" (error)="failed.set(true)" />
    }
    @if (showType()) {
      <span class="type-pill"><ab-icon [name]="icon[item().type]" /></span>
    }
    @if (showText()) {
      <strong>{{ item() | localTitle: lang() }}</strong>
      @if (item().creators) {
        <span class="who">{{ item().creators }}</span>
      }
    }
  `,
})
export class Poster {
  private readonly api = inject(MediaApi);
  protected readonly lang = inject(LanguageService).current;

  readonly item = input.required<MediaItem>();
  /** Title/creator overlay (off for the detail page's big cover). */
  readonly showText = input(true);
  readonly showType = input(true);

  protected readonly failed = signal(false);
  protected readonly icon = TYPE_ICON;
  protected readonly hue = computed(() => hue(this.item()));
  protected readonly coverUrl = computed(() => this.api.coverUrl(this.item().id));
}
