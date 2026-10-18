/**
 * Gives each hover of a `.card-tile` its own holo foil: a random pattern
 * (`data-foil`), angle, colour shift and sweep direction (`--foil-*` CSS
 * variables), which the tile's `::after` reads (styles.scss). Meant as a
 * document `pointerover` listener.
 */
export const FOILS = ['band', 'glare', 'stripes', 'prism', 'glitter'] as const;

export function shuffleFoil(event: PointerEvent, random: () => number = Math.random): void {
  const tile = (event.target as Element | null)?.closest?.('.card-tile');
  // Moving between a tile's own children isn't a new hover.
  if (!(tile instanceof HTMLElement) || tile.contains(event.relatedTarget as Node | null)) return;

  tile.dataset['foil'] = FOILS[Math.floor(random() * FOILS.length)];
  const angle = Math.round(random() * 360);
  // The band sweeps along its gradient line, one way or the other.
  const radians = (angle * Math.PI) / 180;
  const direction = random() < 0.5 ? 1 : -1;
  const x = Math.round(50 + 50 * Math.sin(radians) * direction);
  const y = Math.round(50 - 50 * Math.cos(radians) * direction);

  tile.style.setProperty('--foil-angle', `${angle}deg`);
  tile.style.setProperty('--foil-hue', `${Math.round(random() * 360)}deg`);
  tile.style.setProperty('--foil-from', `${x}% ${y}%`);
  tile.style.setProperty('--foil-to', `${100 - x}% ${100 - y}%`);
}
