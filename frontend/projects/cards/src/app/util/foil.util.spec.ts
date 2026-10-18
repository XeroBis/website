import { FOILS, shuffleFoil } from './foil.util';

describe('shuffleFoil', () => {
  let tile: HTMLElement;
  let image: HTMLElement;

  beforeEach(() => {
    tile = document.createElement('div');
    tile.className = 'card-tile';
    image = document.createElement('img');
    tile.appendChild(image);
    document.body.appendChild(tile);
  });

  afterEach(() => tile.remove());

  const over = (target: Element, relatedTarget: Element | null = null) =>
    ({ target, relatedTarget }) as unknown as PointerEvent;

  it('sets a foil on the tile being entered', () => {
    const values = [0.5, 0.25, 0.9, 0.5];
    shuffleFoil(over(image), () => values.shift()!);
    expect(tile.dataset['foil']).toBe('stripes');
    expect(tile.style.getPropertyValue('--foil-angle')).toBe('90deg');
    expect(tile.style.getPropertyValue('--foil-from')).toBe('0% 50%');
    expect(tile.style.getPropertyValue('--foil-to')).toBe('100% 50%');
    expect(tile.style.getPropertyValue('--foil-hue')).toBe('180deg');
  });

  it('can pick every foil', () => {
    const picked = FOILS.map((_, i) => {
      shuffleFoil(over(image), () => i / FOILS.length);
      return tile.dataset['foil'];
    });
    expect(picked).toEqual([...FOILS]);
  });

  it('keeps the foil while moving inside the same tile', () => {
    shuffleFoil(over(image), () => 0.5);
    shuffleFoil(over(tile, image), () => 0);
    expect(tile.style.getPropertyValue('--foil-angle')).toBe('180deg');
  });

  it('ignores anything outside a tile', () => {
    const other = document.createElement('p');
    document.body.appendChild(other);
    expect(() => shuffleFoil(over(other))).not.toThrow();
    other.remove();
  });
});
