import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService, Header } from '@shared';

export const CONTACT_LINKS = {
  github: 'https://github.com/XeroBis',
  linkedin: 'https://www.linkedin.com/in/alan-bignon/',
};

@Component({
  imports: [Header, RouterLink, RouterOutlet, TranslatePipe],
  selector: 'ab-root',
  template: `
    <ab-header title="Alan Bignon">
      @if (auth.canUse('portfolio')) {
        <a routerLink="/admin/projects/new" data-testid="new-project">{{ 'NAV.NEW_PROJECT' | translate }}</a>
      }
    </ab-header>
    <div class="page">
      <router-outlet />
    </div>
    <footer class="site-footer">
      <a [href]="contact.github" target="_blank" rel="noopener">{{ 'FOOTER.GITHUB' | translate }}</a>
      <a [href]="contact.linkedin" target="_blank" rel="noopener">{{ 'FOOTER.LINKEDIN' | translate }}</a>
    </footer>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly contact = CONTACT_LINKS;
}
