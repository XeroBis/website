import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import { TOOLS } from '../tools';

@Component({
  selector: 'ab-home',
  imports: [Icon, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="home">
      <h1>{{ 'home.title' | translate }}</h1>
      <p class="lead">{{ 'home.lead' | translate }}</p>
      <p class="local"><ab-icon name="lock" /> {{ 'home.local' | translate }}</p>
      <div class="tool-cards">
        @for (tool of tools; track tool.path) {
          <a class="tool-card" [routerLink]="tool.path" [attr.data-tool]="tool.key">
            <span class="tool-icon"><ab-icon [name]="tool.icon" /></span>
            <span class="tool-name">{{ 'tool.' + tool.key + '.name' | translate }}</span>
            <span class="tool-desc">{{ 'tool.' + tool.key + '.desc' | translate }}</span>
          </a>
        }
      </div>
    </section>
  `,
})
export class Home {
  protected readonly tools = TOOLS;
}
