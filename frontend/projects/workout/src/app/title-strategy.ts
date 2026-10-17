import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

/** Route `title`s are translation keys: "Séances · Workout". */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const key = this.buildTitle(snapshot);
    if (!key) {
      this.title.setTitle('Workout');
      return;
    }
    this.translate.get(key).subscribe((text: string) => this.title.setTitle(`${text} · Workout`));
  }
}
