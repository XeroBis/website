import { TestBed } from '@angular/core/testing';

import { Icon, IconName } from './icon';

describe('Icon', () => {
  function render(name: IconName): HTMLElement {
    const fixture = TestBed.createComponent(Icon);
    fixture.componentRef.setInput('name', name);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the named outline icon, hidden from assistive tech', () => {
    const el = render('book');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('svg')?.getAttribute('fill')).toBe('none');
    expect(el.querySelectorAll('svg path').length).toBe(2);
  });

  it('fills the solid icons', () => {
    expect(render('star').querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });
});
