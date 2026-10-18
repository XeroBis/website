import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

/** Route `title`s are translation keys: "Séries · Collection de cartes Pokémon". */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const key = this.buildTitle(snapshot);
    this.translate
      .get(key ? [key, 'app.name'] : ['app.name'])
      .subscribe((texts: Record<string, string>) =>
        this.title.setTitle(key ? `${texts[key]} · ${texts['app.name']}` : texts['app.name']),
      );
  }
}
