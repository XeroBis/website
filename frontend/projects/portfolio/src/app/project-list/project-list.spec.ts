import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { LanguageService, User } from '@shared';

import { Project } from '../projects.service';
import { EDITOR, PROJECT, flushMe, settle, setup } from '../testing';
import { ProjectList } from './project-list';

const PROJECTS: Project[] = [
  { ...PROJECT, id: 1, name: 'Cards', featured: true, tags: ['Angular', 'FastAPI'] },
  {
    ...PROJECT,
    id: 2,
    name: 'Workout',
    description_fr: 'Suivi de séances',
    description_en: 'Workout tracking',
    repo_url: null,
    tags: ['angular', 'Python'],
  },
];

describe('ProjectList', () => {
  let http: HttpTestingController;

  beforeEach(() => (http = setup()));
  afterEach(() => http.verify());

  async function render({ user = null as User | null, tag = undefined as string | undefined } = {}) {
    const fixture = TestBed.createComponent(ProjectList);
    if (tag) fixture.componentRef.setInput('tag', tag);
    flushMe(http, user);
    http.expectOne('/api/portfolio/projects').flush(PROJECTS);
    await fixture.whenStable();
    return fixture;
  }

  const cards = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="project"]')] as HTMLElement[];
  const names = (el: HTMLElement) => cards(el).map((c) => c.querySelector('h3')?.textContent);

  it('lists the projects with the description in the current language', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(names(el)).toEqual(['Cards', 'Workout']);
    expect(cards(el)[0].querySelector('.description')?.textContent).toBe('Collection de cartes');
    expect(cards(el)[0].classList).toContain('featured');
    expect(cards(el)[0].querySelector('.badge')?.textContent).toBe('À la une');
    expect(cards(el)[0].querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(PROJECT.repo_url);
    expect(cards(el)[1].querySelector('a[target="_blank"]')).toBeNull();

    TestBed.inject(LanguageService).set('en');
    await fixture.whenStable();
    expect(cards(el)[0].querySelector('.description')?.textContent).toBe('Card collection');
  });

  it('offers every tag once as a filter', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    const filters = [...el.querySelectorAll('.tag-filter a')].map((a) => a.textContent);
    expect(filters).toEqual(['Tous', 'Angular', 'FastAPI', 'Python']);
    expect(el.querySelector('.tag-filter a[href="/?tag=Python"]')).not.toBeNull();
  });

  it('filters by ?tag= case-insensitively', async () => {
    const el = (await render({ tag: 'ANGULAR' })).nativeElement as HTMLElement;
    expect(names(el)).toEqual(['Cards', 'Workout']);
    expect(el.querySelector('.tag-filter a.active')?.textContent).toBe('Angular');
  });

  it('shows only matching projects, or a message when none match', async () => {
    const fixture = await render({ tag: 'python' });
    const el = fixture.nativeElement as HTMLElement;
    expect(names(el)).toEqual(['Workout']);
    fixture.componentRef.setInput('tag', 'rust');
    await fixture.whenStable();
    expect(names(el)).toEqual([]);
    expect(el.querySelector('[data-testid="empty"]')?.textContent?.trim()).toBe('Aucun projet avec ce tag.');
  });

  it('hides editor actions from visitors', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    expect(el.querySelector('.admin-actions')).toBeNull();
  });

  it('lets an editor edit and delete', async () => {
    const fixture = await render({ user: EDITOR });
    const el = fixture.nativeElement as HTMLElement;
    expect(cards(el)[1].querySelector('.admin-actions a')?.getAttribute('href')).toBe('/admin/projects/2');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    (cards(el)[1].querySelector('button.danger') as HTMLButtonElement).click();
    expect(confirm).toHaveBeenCalledWith('Supprimer « Workout » ?');
    http.expectNone({ method: 'DELETE' });

    confirm.mockReturnValue(true);
    (cards(el)[1].querySelector('button.danger') as HTMLButtonElement).click();
    http.expectOne({ method: 'DELETE', url: '/api/portfolio/projects/2' }).flush(null);
    await settle();
    await fixture.whenStable();
    expect(names(el)).toEqual(['Cards']);
    confirm.mockRestore();
  });

  it('shows an error when the list fails to load', async () => {
    const fixture = TestBed.createComponent(ProjectList);
    flushMe(http, null);
    http.expectOne('/api/portfolio/projects').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await settle();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error')?.textContent).toBe('Échec du chargement des projets.');
  });
});
