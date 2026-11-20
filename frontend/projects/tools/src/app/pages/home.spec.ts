import { TestBed } from '@angular/core/testing';

import { setup, text } from '../testing';
import { Home } from './home';

describe('Home', () => {
  it('lists the six tools', async () => {
    setup();
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const cards = [...el.querySelectorAll('a.tool-card')];
    expect(cards.map((a) => a.getAttribute('href'))).toEqual([
      '/merge',
      '/extract',
      '/organize',
      '/images-to-pdf',
      '/pdf-to-images',
      '/sign',
    ]);
    expect(text(cards[0].querySelector('.tool-name'))).toBe('Fusionner');
  });
});
