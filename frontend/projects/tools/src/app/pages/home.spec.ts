import { TestBed } from '@angular/core/testing';

import { setup, text } from '../testing';
import { Home } from './home';

describe('Home', () => {
  it('lists the five tools and says files stay in the browser', async () => {
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
    ]);
    expect(text(cards[0].querySelector('.tool-name'))).toBe('Fusionner');
    expect(text(el.querySelector('.local'))).toContain('jamais envoyés');
  });
});
