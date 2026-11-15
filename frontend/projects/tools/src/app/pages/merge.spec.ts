import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  FakeRenderer,
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
import { Merge } from './merge';

const move = (previousIndex: number, currentIndex: number) =>
  ({ previousIndex, currentIndex }) as CdkDragDrop<unknown>;

describe('Merge', () => {
  let fixture: ComponentFixture<Merge>;
  let el: HTMLElement;
  let renderer: FakeRenderer;
  let downloads: ReturnType<typeof catchDownloads>;

  beforeEach(async () => {
    ({ renderer } = setup());
    downloads = catchDownloads();
    fixture = TestBed.createComponent(Merge);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => vi.restoreAllMocks());

  async function addFiles(): Promise<void> {
    pick(el, [
      fileOf(await numbered(2), 'a.pdf'),
      fileOf('hello', 'notes.txt', 'text/plain'),
      fileOf('%PDF-broken', 'broken.pdf'),
      fileOf(await numbered(3, 11), 'b.pdf'),
    ]);
    await settle(fixture);
  }

  const chips = () =>
    [...el.querySelectorAll('.chip')].map((c) => text(c.querySelector('.chip-name')));
  const pages = () => [...el.querySelectorAll('.tray figcaption')].map(text);

  it('starts empty, with the merge button disabled', () => {
    expect(text(el.querySelector('.empty p'))).toBe('Déposez des PDF ici, ou choisissez-les.');
    expect(el.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true);
  });

  it('adds the PDFs, lists their pages, and says what it skipped', async () => {
    await addFiles();
    expect(chips()).toEqual(['a.pdf', 'b.pdf']);
    expect(pages()).toEqual(['a.pdf · 1', 'a.pdf · 2', 'b.pdf · 1', 'b.pdf · 2', 'b.pdf · 3']);
    expect([...el.querySelectorAll('.notice p')].map(text)).toEqual([
      "notes.txt n'est pas un PDF : ignoré.",
      'broken.pdf est illisible (endommagé ?) : ignoré.',
    ]);
    expect(text(el.querySelector('.summary'))).toBe('5 pages · 2 fichiers');
  });

  it('merges pages in the order shown, under the chosen name', async () => {
    await addFiles();
    const merge = fixture.componentInstance as unknown as {
      dropPage(e: CdkDragDrop<unknown>): void;
      dropFile(e: CdkDragDrop<unknown>): void;
    };
    merge.dropFile(move(1, 0)); // b's pages first, as a block
    merge.dropPage(move(4, 0)); // then a's last page to the front
    await fixture.whenStable();
    expect(pages()).toEqual(['a.pdf · 2', 'b.pdf · 1', 'b.pdf · 2', 'b.pdf · 3', 'a.pdf · 1']);

    click(el, 'Retirer la page 2 de b.pdf');
    const name = el.querySelector<HTMLInputElement>('.action-bar input')!;
    name.value = 'together';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    click(el, 'Fusionner et télécharger');
    await settle(fixture);

    expect(downloads.map((d) => d.name)).toEqual(['together.pdf']);
    const merged = await describePdf(await bytesOf(downloads[0].blob));
    expect(merged.map((p) => p.width)).toEqual([102, 111, 113, 101]);
  });

  it('removes a file with its pages and frees its renderer document', async () => {
    await addFiles();
    click(el, 'Retirer a.pdf');
    await fixture.whenStable();
    expect(chips()).toEqual(['b.pdf']);
    expect(pages()).toEqual(['b.pdf · 1', 'b.pdf · 2', 'b.pdf · 3']);
    expect(renderer.released).toHaveLength(1);
  });
});
