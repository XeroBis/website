import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { ADMIN, PROJECT, flushMe, settle, setup } from '../testing';
import { ProjectForm, parseTags } from './project-form';

describe('parseTags', () => {
  it('trims, drops blanks and case-insensitive repeats', () => {
    expect(parseTags(' Angular, ,FastAPI , angular,')).toEqual(['Angular', 'FastAPI']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('ProjectForm', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ProjectForm>;
  let el: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    http = setup();
  });
  afterEach(() => http.verify());

  async function render(id?: string, tags: string[] = ['Docker', 'Python']) {
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    fixture = TestBed.createComponent(ProjectForm);
    if (id) fixture.componentRef.setInput('id', id);
    flushMe(http, ADMIN);
    fixture.detectChanges();
    http.expectOne('/api/portfolio/tags').flush(tags);
    el = fixture.nativeElement;
  }

  function type(selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function fill() {
    type('[formControlName="name"]', ' New ');
    type('[formControlName="description_fr"]', 'Un projet');
    type('[formControlName="description_en"]', 'A project');
    type('[formControlName="tags"]', 'Angular, , angular, FastAPI');
    await fixture.whenStable();
  }

  const submitButton = () => el.querySelector('button[type="submit"]') as HTMLButtonElement;

  it('creates a project and goes back to the list', async () => {
    await render();
    expect(el.querySelector('h1')?.textContent).toBe('Nouveau projet');
    expect(submitButton().disabled).toBe(true);
    await fill();
    expect(submitButton().disabled).toBe(false);
    submitButton().click();

    const req = http.expectOne({ method: 'POST', url: '/api/portfolio/projects' });
    expect(req.request.body).toEqual({
      name: ' New ',
      description_fr: 'Un projet',
      description_en: 'A project',
      repo_url: null,
      tags: ['Angular', 'FastAPI'],
      position: 0,
      featured: false,
    });
    req.flush({ ...PROJECT, id: 9 });
    await settle();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('adds a suggested tag on click', async () => {
    await render();
    await fill();
    (el.querySelector('.suggestions button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect((el.querySelector('[formControlName="tags"]') as HTMLInputElement).value).toBe(
      'Angular, FastAPI, Docker',
    );
  });

  it('loads and updates an existing project', async () => {
    await render('3');
    http.expectOne('/api/portfolio/projects/3').flush(PROJECT);
    await settle();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toBe('Modifier le projet');
    expect((el.querySelector('[formControlName="tags"]') as HTMLInputElement).value).toBe('Angular, FastAPI');

    type('[formControlName="repo_url"]', '  ');
    await fixture.whenStable();
    submitButton().click();
    const req = http.expectOne({ method: 'PUT', url: '/api/portfolio/projects/3' });
    expect(req.request.body).toEqual({
      name: 'Cards',
      description_fr: 'Collection de cartes',
      description_en: 'Card collection',
      repo_url: null,
      tags: ['Angular', 'FastAPI'],
      position: 0,
      featured: false,
    });
    req.flush(PROJECT);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows an error for an unknown project', async () => {
    await render('404');
    http.expectOne('/api/portfolio/projects/404').flush(null, { status: 404, statusText: 'Not Found' });
    await settle();
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent).toBe('Projet introuvable.');
    expect(el.querySelector('form')).toBeNull();
  });

  it('rejects invalid fields before sending', async () => {
    await render();
    await fill();
    type('[formControlName="repo_url"]', 'http://github.com/x');
    await fixture.whenStable();
    expect(submitButton().disabled).toBe(true);
    type('[formControlName="repo_url"]', 'https://gitlab.com/x');
    type('[formControlName="tags"]', Array.from({ length: 11 }, (_, i) => `t${i}`).join(','));
    await fixture.whenStable();
    expect(submitButton().disabled).toBe(true);
    type('[formControlName="tags"]', 'x'.repeat(31));
    await fixture.whenStable();
    expect(submitButton().disabled).toBe(true);
    type('[formControlName="tags"]', 'ok');
    type('[formControlName="description_en"]', '   ');
    await fixture.whenStable();
    expect(submitButton().disabled).toBe(true);
  });

  it.each([
    [409, 'Un projet porte déjà ce nom.'],
    [422, 'Vérifiez les champs.'],
    [403, 'Session expirée ou accès refusé, reconnectez-vous.'],
    [500, "Échec de l'enregistrement."],
  ])('shows the error for a %i', async (status, message) => {
    await render();
    await fill();
    submitButton().click();
    http
      .expectOne({ method: 'POST', url: '/api/portfolio/projects' })
      .flush(null, { status, statusText: 'Error' });
    await settle();
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent).toBe(message);
    expect(navigate).not.toHaveBeenCalled();
  });
});
