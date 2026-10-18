import { HttpEvent, HttpEventType } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { provideI18n, AuthService } from '@shared';
import { signal } from '@angular/core';
import en from '../../../i18n/en.json';
import fr from '../../../i18n/fr.json';
import { CatalogService } from '../../services/catalog.service';
import { CatalogManagementComponent, REFRESH_STEPS } from './catalog-management.component';
import { RefreshStepStatus } from '../../models/card.model';

const status = (state: RefreshStepStatus['status'], step = 'restore'): RefreshStepStatus => ({
  status: state,
  step,
  step_label: step,
  step_index: 1,
  total_steps: 3,
  percent: 50,
  sub_done: 1,
  sub_total: 2,
  result: { copied: 2 },
  error: null,
  last_run_at: null,
  last_run_result: null,
});

function setup(initial: 'idle' | 'running' = 'idle', runningRefresh = false) {
  let imageState = status(initial);
  let refreshState = status(runningRefresh ? 'running' : 'idle', 'import_html');
  const upload = new Subject<HttpEvent<{ status: string }>>();
  const api = {
    getStats: () =>
      of({
        total_cards: 1,
        total_sets: 1,
        distinct_card_names: 1,
        variant_counts: { standard: 1 },
      }),
    listSets: () => of([{ set_code: 'BS', set_name: 'Base' }]),
    refreshStatus: vi.fn(() => of(refreshState)),
    refreshStepStatus: vi.fn((key: string) =>
      of(key === 'import_html' ? refreshState : status('idle')),
    ),
    imageImportStatus: vi.fn(() => of(imageState)),
    importImages: vi.fn((_file: File, _selection: unknown) => upload),
    exportImagesUrl: () => '/api/cards/catalog/export/images?set_code=BS',
    startRefresh: vi.fn(() => of({ status: 'started' })),
    startRefreshStep: vi.fn(() => of({ status: 'started' })),
    importCatalog: vi.fn(() => of({ created: 1, updated: 0 })),
  };
  TestBed.configureTestingModule({
    providers: [
      provideI18n({ en, fr }),
      { provide: CatalogService, useValue: api },
      { provide: AuthService, useValue: { load: async () => null, user: signal(null) } },
    ],
  });
  const fixture = TestBed.createComponent(CatalogManagementComponent);
  return {
    fixture,
    page: fixture.componentInstance,
    api,
    upload,
    setRefreshState: (value: RefreshStepStatus) => {
      refreshState = value;
    },
    setImageState: (value: RefreshStepStatus) => {
      imageState = value;
    },
  };
}

describe('Catalog job lifecycle', () => {
  it('reattaches to image imports and refresh steps on page load and polls to completion', async () => {
    const { fixture, page, api, setImageState } = setup('running');
    await fixture.whenStable();
    expect(api.refreshStatus).toHaveBeenCalledOnce();
    expect(api.refreshStepStatus.mock.calls.map((call) => call[0])).toEqual([...REFRESH_STEPS]);
    expect(page.statuses()['images'].status).toBe('running');
    expect(page.busy()).toBe(true);
    setImageState(status('done'));
    await vi.waitFor(() => expect(page.statuses()['images'].status).toBe('done'), {
      timeout: 2000,
    });
    expect(page.busy()).toBe(false);
    fixture.destroy();
  });

  it('keeps restore progress after the upload receives 202, and exports with an anchor', async () => {
    const { fixture, page, api, upload, setImageState } = setup();
    await fixture.whenStable();
    const file = new File(['zip'], 'images.zip');
    page.importImages({ target: { files: [file], value: '' } } as unknown as Event);
    expect(api.importImages.mock.calls[0][0]).toBe(file);
    upload.next({ type: HttpEventType.UploadProgress, loaded: 25, total: 100 });
    expect(page.uploadPercent()).toBe(25);
    setImageState(status('running'));
    upload.next({
      type: HttpEventType.Response,
      status: 202,
      body: { status: 'started' },
    } as HttpEvent<{ status: string }>);
    upload.complete();
    await fixture.whenStable();
    expect(page.uploading()).toBe(false);
    expect(page.statuses()['images'].status).toBe('running');
    expect(page.busy()).toBe(true);
    const link = fixture.nativeElement.querySelector('a[download="card_images.zip"]');
    expect(link.getAttribute('href')).toBe('/api/cards/catalog/export/images?set_code=BS');
    fixture.destroy();
  });

  it('shows a 409 refusal and handles unreadable JSON', async () => {
    const { fixture, page, api, upload } = setup();
    await fixture.whenStable();
    page.importImages({
      target: { files: [new File(['zip'], 'images.zip')], value: '' },
    } as unknown as Event);
    upload.error({ status: 409, error: { detail: 'A catalog job is already running' } });
    expect(page.error()).toContain('already running');
    await page.importMetadata({
      target: { files: [{ text: async () => '{invalid' }], value: '' },
    } as unknown as Event);
    expect(page.error()).toBeTruthy();
    expect(page.pending()).toBe(false);
    expect(api.importCatalog).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('reattaches to a full refresh and its active step without restarting either job', async () => {
    const { fixture, page, api, setRefreshState } = setup('idle', true);
    await fixture.whenStable();
    expect(page.statuses()['full'].status).toBe('running');
    expect(page.statuses()['import_html'].status).toBe('running');
    expect(api.startRefresh).not.toHaveBeenCalled();
    expect(api.startRefreshStep).not.toHaveBeenCalled();
    setRefreshState(status('done', 'import_html'));
    await vi.waitFor(() => expect(page.statuses()['full'].status).toBe('done'), { timeout: 2000 });
    expect(page.statuses()['import_html'].status).toBe('done');
    fixture.destroy();
  });

  it('shows the server validation detail for a rejected metadata import', async () => {
    const { fixture, page, api } = setup();
    await fixture.whenStable();
    api.importCatalog.mockReturnValue(
      throwError(() => ({
        status: 422,
        error: { detail: [{ loc: ['body', 'cards'], msg: 'A catalog file cannot be empty' }] },
      })),
    );
    await page.importMetadata({
      target: { files: [{ text: async () => '{"cards":[]}' }], value: '' },
    } as unknown as Event);
    expect(page.error()).toBe('body.cards: A catalog file cannot be empty');
    expect(page.pending()).toBe(false);
    fixture.destroy();
  });
});
