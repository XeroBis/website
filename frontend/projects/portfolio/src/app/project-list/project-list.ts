import { DOCUMENT, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService, LanguageService } from '@shared';

import { Project, ProjectsService } from '../projects.service';

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * `/`: the intro and the public project list, filterable by tag (`?tag=`).
 * Admins also get Edit/Delete on each card.
 */
@Component({
  selector: 'ab-project-list',
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="intro">
      <p class="eyebrow">alanbignon.com</p>
      <h1>Alan Bignon</h1>
      <p class="subtitle">{{ 'HOME.SUBTITLE' | translate }}</p>
      <p class="bio">{{ 'HOME.BIO' | translate }}</p>
    </section>

    <section class="projects">
      <div class="section-head">
        <h2>{{ 'HOME.PROJECTS' | translate }}</h2>
        <p class="muted">{{ 'HOME.PROJECTS_SUB' | translate }}</p>
      </div>

      @if (allTags().length) {
        <nav class="tag-filter">
          <a class="tag" routerLink="/" [class.active]="!tag()">{{ 'HOME.ALL_TAGS' | translate }}</a>
          @for (t of allTags(); track t) {
            <a class="tag" routerLink="/" [queryParams]="{ tag: t }" [class.active]="isActive(t)">{{ t }}</a>
          }
        </nav>
      }

      @if (error()) {
        <p class="error" role="alert">{{ error() | translate }}</p>
      }

      @if (projects() === null) {
        @if (!error()) {
          <p class="muted">{{ 'HOME.LOADING' | translate }}</p>
        }
      } @else if (visible().length === 0) {
        <p class="muted" data-testid="empty">
          {{ (tag() ? 'HOME.EMPTY_TAG' : 'HOME.EMPTY') | translate }}
        </p>
      } @else {
        <div class="cards">
          @for (project of visible(); track project.id) {
            <article class="card" [class.featured]="project.featured" data-testid="project">
              <header>
                <span class="index" aria-hidden="true">{{ ($index + 1).toString().padStart(2, '0') }}</span>
                <h3>{{ project.name }}</h3>
                @if (project.featured) {
                  <span class="badge">{{ 'HOME.FEATURED' | translate }}</span>
                }
              </header>
              <p class="description">{{ description(project) }}</p>
              @if (project.tags.length) {
                <div class="tags">
                  @for (t of project.tags; track t) {
                    <a class="tag" routerLink="/" [queryParams]="{ tag: t }">{{ t }}</a>
                  }
                </div>
              }
              <footer>
                @if (project.repo_url) {
                  <a class="source" [href]="project.repo_url" target="_blank" rel="noopener">{{ 'HOME.SOURCE' | translate }} ↗</a>
                }
                @if (auth.isAdmin()) {
                  <span class="admin-actions">
                    <a [routerLink]="['/admin/projects', project.id]">{{ 'HOME.EDIT' | translate }}</a>
                    <button type="button" class="link-btn danger" (click)="remove(project)">
                      {{ 'HOME.DELETE' | translate }}
                    </button>
                  </span>
                }
              </footer>
            </article>
          }
        </div>
      }
    </section>
  `,
})
export class ProjectList {
  /** `?tag=`: only projects with this tag (case-insensitive). */
  readonly tag = input<string>();

  protected readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);
  private readonly service = inject(ProjectsService);
  private readonly translate = inject(TranslateService);
  private readonly window = inject(DOCUMENT).defaultView;

  protected readonly projects = signal<Project[] | null>(null);
  protected readonly error = signal('');

  protected readonly allTags = computed(() => {
    const tags = new Map<string, string>();
    for (const t of (this.projects() ?? []).flatMap((p) => p.tags)) {
      if (!tags.has(t.toLowerCase())) tags.set(t.toLowerCase(), t);
    }
    return [...tags.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  });

  protected readonly visible = computed(() => {
    const tag = this.tag();
    const projects = this.projects() ?? [];
    return tag ? projects.filter((p) => p.tags.some((t) => sameTag(t, tag))) : projects;
  });

  constructor() {
    this.service.list().then(
      (projects) => this.projects.set(projects),
      () => this.error.set('HOME.LOAD_ERROR'),
    );
  }

  protected isActive(tag: string): boolean {
    const current = this.tag();
    return !!current && sameTag(current, tag);
  }

  protected description(project: Project): string {
    return this.language.current() === 'en' ? project.description_en : project.description_fr;
  }

  protected async remove(project: Project): Promise<void> {
    const question = this.translate.instant('HOME.DELETE_CONFIRM', { name: project.name });
    if (!this.window?.confirm(question)) return;
    this.error.set('');
    try {
      await this.service.delete(project.id);
      this.projects.update((list) => list?.filter((p) => p.id !== project.id) ?? null);
    } catch {
      this.error.set('HOME.DELETE_ERROR');
    }
  }
}
