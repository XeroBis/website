import { TestBed } from '@angular/core/testing';
import { provideI18n } from '@shared';

import en from '../../../../i18n/en.json';
import fr from '../../../../i18n/fr.json';
import { VariantType } from '../../../models/card.model';
import { PrintFiltersComponent } from './print-filters.component';

const OPTIONS: VariantType[] = [
  'reverse',
  'reverse_pokeball',
  'reverse_rocketball',
  'stamp_league',
  'holo_cosmos',
];

describe('PrintFiltersComponent print row', () => {
  async function render(collapse: boolean, selected: VariantType[] = []) {
    TestBed.configureTestingModule({ providers: [provideI18n({ en, fr })] });
    const fixture = TestBed.createComponent(PrintFiltersComponent);
    fixture.componentRef.setInput('variants', OPTIONS);
    fixture.componentRef.setInput('selectedVariants', selected);
    fixture.componentRef.setInput('collapseVariants', collapse);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const shown = () =>
      [...el.querySelectorAll('.variant-btn')].map((b) => b.getAttribute('title'));
    const more = () => el.querySelector<HTMLButtonElement>('.more-btn');
    return { fixture, shown, more };
  }

  it('keeps reverse and the ball reverses in view, the rest behind "+"', async () => {
    const { fixture, shown, more } = await render(true);
    expect(shown()).toEqual(['Reverse', 'Reverse Poké Ball', 'Reverse Rocket Ball']);
    expect(more()?.textContent?.trim()).toBe('+2');
    more()!.click();
    await fixture.whenStable();
    expect(shown()).toHaveLength(5);
    expect(more()?.textContent?.trim()).toBe('−');
    more()!.click();
    await fixture.whenStable();
    expect(shown()).toHaveLength(3);
  });

  it('still shows a hidden variant once it is selected', async () => {
    const { shown, more } = await render(true, ['holo_cosmos']);
    expect(shown()).toContain('Holo Cosmos');
    expect(more()?.textContent?.trim()).toBe('+1');
  });

  it('shows every variant when not collapsed', async () => {
    const { shown, more } = await render(false);
    expect(shown()).toHaveLength(5);
    expect(more()).toBeNull();
  });

  it('starts each row with an "all" button that clears the selection', async () => {
    const { fixture } = await render(false, ['reverse']);
    const component = fixture.componentInstance;
    const emitted: VariantType[][] = [];
    component.variantsChange.subscribe((v) => emitted.push(v));
    const all = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '.all-btn',
    );
    expect(all).toHaveLength(2);
    expect(all[1].getAttribute('aria-pressed')).toBe('false');
    all[1].click();
    expect(emitted).toEqual([[]]);
  });
});
