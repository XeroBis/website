import { TestBed } from '@angular/core/testing';

import { LanguageService } from '@shared';

import { setup } from '../testing';
import { PluralPipe } from './plural';

describe('PluralPipe', () => {
  it('follows the language: 0 is singular in French only', async () => {
    setup();
    const pipe = TestBed.runInInjectionContext(() => new PluralPipe());
    expect([0, 1, 2].map((n) => pipe.transform('k', n))).toEqual(['k.one', 'k.one', 'k.other']);
    await TestBed.inject(LanguageService).change('en');
    expect([0, 1, 2].map((n) => pipe.transform('k', n))).toEqual(['k.other', 'k.one', 'k.other']);
  });
});
