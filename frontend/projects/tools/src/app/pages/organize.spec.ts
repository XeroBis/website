import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  bytesOf,
  catchDownloads,
  click,
  describePdf,
  fileOf,
  numbered,
  pick,
  settle,
  setup,
  text,
} from '../testing';
import { Organize } from './organize';

describe('Organize', () => {
  let fixture: ComponentFixture<Organize>;
  let el: HTMLElement;
  let downloads: ReturnType<typeof catchDownloads>;

  beforeEach(async () => {
    setup();
    downloads = catchDownloads();
    fixture = TestBed.createComponent(Organize);
    el = fixture.nativeElement;
    await fixture.whenStable();
    pick(el, [fileOf(await numbered(4), 'scan.pdf')]);
    await settle(fixture);
  });

  afterEach(() => vi.restoreAllMocks());

  const summary = () => text(el.querySelector('.summary'));

  it('rotates, deletes, undoes and resets', async () => {
    expect(summary()).toBe('4 pages · 0 pivotée · 0 supprimée');
    expect(el.querySelector<HTMLButtonElement>('.btn-secondary')!.disabled).toBe(true);

    click(el, 'Pivoter la page 2 à droite');
    click(el, 'Supprimer la page 3');
    click(el, 'Supprimer la page 4');
    await fixture.whenStable();
    expect(summary()).toBe('2 pages · 1 pivotée · 2 supprimées');
    expect(el.querySelectorAll('.page.deleted')).toHaveLength(2);
    expect(el.querySelectorAll<HTMLElement>('ab-page-thumb')[1].querySelector('img')).toBeDefined();

    click(el, '.page.deleted .btn-small'); // undo page 3
    await fixture.whenStable();
    expect(summary()).toBe('3 pages · 1 pivotée · 1 supprimée');

    click(el, 'Réinitialiser');
    await fixture.whenStable();
    expect(summary()).toBe('4 pages · 0 pivotée · 0 supprimée');
  });

  it('saves the pages kept, in their new order, turned', async () => {
    const organize = fixture.componentInstance as unknown as {
      drop(e: CdkDragDrop<unknown>): void;
    };
    organize.drop({ previousIndex: 3, currentIndex: 0 } as CdkDragDrop<unknown>);
    await fixture.whenStable();
    click(el, 'Pivoter la page 1 à gauche');
    click(el, 'Pivoter la page 4 à droite');
    click(el, 'Pivoter la page 4 à droite');
    click(el, 'Supprimer la page 2');
    await fixture.whenStable();
    click(el, 'Enregistrer le PDF');
    await settle(fixture);
    expect(downloads.map((d) => d.name)).toEqual(['scan-organized.pdf']);
    expect(await describePdf(await bytesOf(downloads[0].blob))).toEqual([
      { width: 104, rotate: 180 },
      { width: 101, rotate: 270 },
      { width: 103, rotate: 0 },
    ]);
  });

  it('cannot save once every page is deleted', async () => {
    for (const n of [1, 2, 3, 4]) click(el, `Supprimer la page ${n}`);
    await fixture.whenStable();
    expect(el.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true);
  });
});
