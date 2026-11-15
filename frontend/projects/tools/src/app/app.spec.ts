import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { flushMe, setup } from './testing';

describe('App', () => {
  it('shows the header with a link per tool', async () => {
    const { http } = setup();
    const fixture = TestBed.createComponent(App);
    flushMe(http);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ab-header .title')?.textContent).toBe('Tools');
    const links = [...el.querySelectorAll('ab-header .links a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/merge',
      '/extract',
      '/organize',
      '/images-to-pdf',
      '/pdf-to-images',
    ]);
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Fusionner',
      'Extraire',
      'Organiser',
      'Images → PDF',
      'PDF → images',
    ]);
    http.verify();
  });
});
