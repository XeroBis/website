import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Header, Icon } from '@shared';

import { TOOLS } from './tools';

@Component({
  imports: [Header, Icon, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe],
  selector: 'ab-root',
  template: `
    <ab-header title="Tools">
      @for (tool of tools; track tool.path) {
        <a [routerLink]="tool.path" routerLinkActive="active"
          ><ab-icon [name]="tool.icon" /> {{ 'tool.' + tool.key + '.name' | translate }}</a
        >
      }
    </ab-header>
    <main class="frame">
      <router-outlet />
    </main>
  `,
})
export class App {
  protected readonly tools = TOOLS;
}
