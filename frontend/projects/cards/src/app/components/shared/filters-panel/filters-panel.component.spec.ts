import { TestBed } from '@angular/core/testing';
import { provideI18n } from '@shared';

import en from '../../../../i18n/en.json';
import fr from '../../../../i18n/fr.json';
import { VariantType } from '../../../models/card.model';
import { FiltersPanelComponent } from './filters-panel.component';

const OPTIONS: VariantType[] = [
  'reverse',
  'reverse_pokeball',
  'reverse_rocketball',
  'stamp_league',
  'holo_cosmos',
];

describe('FiltersPanelComponent variant filter', () => {
  async function render(collapse: boolean, selected: VariantType[] = []) {
    TestBed.configureTestingModule({ providers: [provideI18n({ en, fr })] });
    const fixture = TestBed.createComponent(FiltersPanelComponent);
    fixture.componentRef.setInput('variantOptions', OPTIONS);
    fixture.componentRef.setInput('variantType', selected);
    fixture.componentRef.setInput('collapseVariants', collapse);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const shown = () =>
      [...el.querySelectorAll('.variant-icon-row .rarity-toggle-btn')].map((b) =>
        b.getAttribute('title'),
      );
    const more = () => el.querySelector<HTMLButtonElement>('.variant-more-btn');
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
});
