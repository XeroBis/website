import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { readJson } from '@shared';
import { CardsService } from './cards.service';
import { CatalogService, ImageArchiveSelection } from './catalog.service';
import { DecksService } from './decks.service';
import { CombatsService } from './combats.service';
import { PurchasesService } from './purchases.service';
import { PublicSharesService } from './shares.service';
import { variantIconUrl } from '../util/variant-icons.util';

const selection: ImageArchiveSelection = {
  french: true,
  english: false,
  standard: true,
  variants: true,
  logos: false,
  symbols: true,
  setCodes: ['SV1', 'SV2'],
};
describe('Cards API migration contract', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('edits and removes a deck row by its row id, without the old variant query', async () => {
    const api = TestBed.inject(DecksService);
    const update = firstValueFrom(api.updateCard(5, 91, { quantity_in_deck: 2 }));
    const request = http.expectOne('/api/cards/decks/5/cards/91');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ quantity_in_deck: 2 });
    request.flush({});
    await update;
    const remove = firstValueFrom(api.removeCard(5, 91));
    const deletion = http.expectOne('/api/cards/decks/5/cards/91');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null);
    await remove;
  });

  it('sends parsed JSON imports for every supported file type', async () => {
    const cases: [string, (data: unknown) => unknown][] = [
      [
        '/collection/import',
        (data) => TestBed.inject(CardsService).importCollection(data).subscribe(),
      ],
      ['/decks/import', (data) => TestBed.inject(DecksService).importDeck(data).subscribe()],
      [
        '/decks/import-all',
        (data) => TestBed.inject(DecksService).importAllDecks(data).subscribe(),
      ],
      ['/combats/import-all', (data) => TestBed.inject(CombatsService).importAll(data).subscribe()],
      [
        '/purchases/import-all',
        (data) => TestBed.inject(PurchasesService).importAll(data).subscribe(),
      ],
      [
        '/catalog/import/metadata',
        (data) => TestBed.inject(CatalogService).importCatalog(data).subscribe(),
      ],
    ];
    const data = await readJson({ text: async () => '{"cards": []}' } as File);
    for (const [route, send] of cases) {
      send(data);
      const request = http.expectOne('/api/cards' + route);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ cards: [] });
      expect(request.request.body).not.toBeInstanceOf(FormData);
      request.flush({});
    }
  });

  it('uploads the original File as application/zip with progress enabled', () => {
    const file = new File(['archive'], 'images.zip', { type: 'application/zip' });
    TestBed.inject(CatalogService).importImages(file, selection).subscribe();
    const request = http.expectOne((r) => r.url === '/api/cards/catalog/import/images');
    expect(request.request.body).toBe(file);
    expect(request.request.headers.get('Content-Type')).toBe('application/zip');
    expect(request.request.reportProgress).toBe(true);
    expect(request.request.params.getAll('set_code')).toEqual(['SV1', 'SV2']);
    request.flush({ status: 'started' }, { status: 202, statusText: 'Accepted' });
  });

  it('builds a streaming download URL without requesting a Blob', () => {
    const url = new URL(
      TestBed.inject(CatalogService).exportImagesUrl(selection),
      'https://cards.example',
    );
    expect(url.pathname).toBe('/api/cards/catalog/export/images');
    expect(url.searchParams.getAll('set_code')).toEqual(['SV1', 'SV2']);
    expect(url.searchParams.get('english')).toBe('false');
    http.expectNone((r) => r.url.includes('/export/images'));
  });

  it('keeps public images token-scoped and maps thumbnails and badges', () => {
    const publicApi = TestBed.inject(PublicSharesService);
    const path = 'SV/SV1/cards/1_EN.jpg';
    expect(publicApi.thumbnailUrl('token', path)).toBe(
      '/api/cards/public/shares/token/images/SV/SV1/thumbnails/1_EN.jpg',
    );
    expect(publicApi.logoUrl('token')).toBe('/api/cards/public/shares/token/logo');
    expect(TestBed.inject(CatalogService).thumbnailUrl(path)).toBe(
      '/api/cards/images/SV/SV1/thumbnails/1_EN.jpg',
    );
    expect(variantIconUrl('reverse')).toBe('/api/cards/public/variant-icons/reverse.svg');
  });
});
