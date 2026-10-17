import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { flushMe, setup } from '../testing';
import { StarRating } from './star-rating';

describe('StarRating', () => {
  let http: HttpTestingController;

  beforeEach(() => (http = setup()));

  async function render(value: number | null) {
    const fixture = TestBed.createComponent(StarRating);
    fixture.componentRef.setInput('value', value);
    const picked = vi.fn();
    fixture.componentInstance.valueChange.subscribe(picked);
    flushMe(http);
    await fixture.whenStable();
    return { el: fixture.nativeElement as HTMLElement, picked };
  }

  it('shows half stars as 0.5-5 in the current locale', async () => {
    const { el } = await render(7);
    expect(el.querySelector('.value')?.textContent?.trim()).toBe('3,5 / 5');
    const fills = [...el.querySelectorAll<HTMLElement>('.fill')].map((f) => f.style.width);
    expect(fills).toEqual(['100%', '100%', '100%', '50%', '0%']);
  });

  it('picks a half or whole star, and clears on the current value or Clear', async () => {
    const { el, picked } = await render(4);
    const halves = el.querySelectorAll<HTMLButtonElement>('.half');
    halves[4].click(); // third star, left half
    expect(picked).toHaveBeenLastCalledWith(5);
    halves[3].click(); // second star, right half = the current value
    expect(picked).toHaveBeenLastCalledWith(null);
    (el.querySelector('.btn') as HTMLButtonElement).click();
    expect(picked).toHaveBeenLastCalledWith(null);
  });

  it('says unrated, with no Clear button', async () => {
    const { el } = await render(null);
    expect(el.querySelector('.value')?.textContent?.trim()).toBe('Non noté');
    expect(el.querySelector('.btn')).toBeNull();
  });
});
