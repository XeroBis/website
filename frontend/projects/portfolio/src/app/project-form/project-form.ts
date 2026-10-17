import { Component, OnInit, inject, input, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { httpStatus } from '@shared';

import { ProjectInput, ProjectsService } from '../projects.service';

const MAX_TAGS = 10;
const TAG_MAX_LENGTH = 30;

/** "a, b ,, A" → ["a", "b"]: trimmed, blanks and case-insensitive repeats dropped. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

function tagsValidator(control: AbstractControl<string>): ValidationErrors | null {
  const tags = parseTags(control.value);
  if (tags.length > MAX_TAGS) return { tooManyTags: true };
  if (tags.some((t) => t.length > TAG_MAX_LENGTH)) return { tagTooLong: true };
  return null;
}

const notBlank = Validators.pattern(/\S/);

/**
 * `/admin/projects/new` and `/admin/projects/:id` (behind appGuard('portfolio')):
 * create or fully update a project, then back to the list.
 */
@Component({
  selector: 'ab-project-form',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  template: `
    <main class="form-page">
      <h1>{{ (id() ? 'FORM.EDIT_TITLE' : 'FORM.NEW_TITLE') | translate }}</h1>

      @if (loading()) {
        <p class="muted">{{ 'FORM.LOADING' | translate }}</p>
      } @else if (loadError()) {
        <p class="error" role="alert">{{ 'FORM.LOAD_ERROR' | translate }}</p>
        <a routerLink="/">{{ 'FORM.CANCEL' | translate }}</a>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()">
          <label>
            {{ 'FORM.NAME' | translate }}
            <input type="text" formControlName="name" maxlength="100" />
          </label>
          <label>
            {{ 'FORM.DESCRIPTION_FR' | translate }}
            <textarea formControlName="description_fr" rows="4" maxlength="1000"></textarea>
          </label>
          <label>
            {{ 'FORM.DESCRIPTION_EN' | translate }}
            <textarea formControlName="description_en" rows="4" maxlength="1000"></textarea>
          </label>
          <label>
            {{ 'FORM.REPO_URL' | translate }}
            <span class="hint">{{ 'FORM.REPO_URL_HINT' | translate }}</span>
            <input type="url" formControlName="repo_url" maxlength="300" placeholder="https://github.com/…" />
          </label>
          <label>
            {{ 'FORM.TAGS' | translate }}
            <span class="hint">{{ 'FORM.TAGS_HINT' | translate }}</span>
            <input type="text" formControlName="tags" placeholder="Angular, FastAPI" />
          </label>
          @if (suggestions().length) {
            <div class="tags suggestions">
              <span class="hint">{{ 'FORM.TAGS_SUGGESTIONS' | translate }}</span>
              @for (t of suggestions(); track t) {
                <button type="button" class="tag" (click)="addTag(t)">{{ t }}</button>
              }
            </div>
          }
          <div class="row">
            <label>
              {{ 'FORM.POSITION' | translate }}
              <span class="hint">{{ 'FORM.POSITION_HINT' | translate }}</span>
              <input type="number" formControlName="position" min="0" step="1" />
            </label>
            <label class="checkbox">
              <input type="checkbox" formControlName="featured" />
              {{ 'FORM.FEATURED' | translate }}
            </label>
          </div>

          @if (error()) {
            <p class="error" role="alert">{{ error() | translate }}</p>
          }
          <div class="row">
            <button type="submit" [disabled]="form.invalid || saving()">{{ 'FORM.SAVE' | translate }}</button>
            <a routerLink="/">{{ 'FORM.CANCEL' | translate }}</a>
          </div>
        </form>
      }
    </main>
  `,
})
export class ProjectForm implements OnInit {
  /** Route param `:id`; absent on `/admin/projects/new`. */
  readonly id = input<string>();

  private readonly service = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(100), notBlank]],
    description_fr: ['', [Validators.required, Validators.maxLength(1000), notBlank]],
    description_en: ['', [Validators.required, Validators.maxLength(1000), notBlank]],
    repo_url: ['', [Validators.maxLength(300), Validators.pattern(/^\s*(https:\/\/[^\s/]+\S*)?\s*$/)]],
    tags: ['', tagsValidator],
    position: [0, [Validators.required, Validators.min(0), Validators.pattern(/^\d+$/)]],
    featured: [false],
  });
  protected readonly suggestions = signal<string[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    this.service.tags().then(
      (tags) => this.suggestions.set(tags),
      () => undefined, // suggestions are optional
    );
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    try {
      const { name, description_fr, description_en, repo_url, tags, position, featured } =
        await this.service.get(Number(id));
      this.form.setValue({
        name,
        description_fr,
        description_en,
        repo_url: repo_url ?? '',
        tags: tags.join(', '),
        position,
        featured,
      });
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected addTag(tag: string): void {
    const tags = parseTags(this.form.controls.tags.value);
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    this.form.controls.tags.setValue([...tags, tag].join(', '));
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    const project: ProjectInput = {
      ...value,
      repo_url: value.repo_url.trim() || null,
      tags: parseTags(value.tags),
    };
    this.error.set('');
    this.saving.set(true);
    try {
      const id = this.id();
      await (id ? this.service.update(Number(id), project) : this.service.create(project));
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.error.set(errorMessage(httpStatus(err)));
    } finally {
      this.saving.set(false);
    }
  }
}

function errorMessage(status: number): string {
  switch (status) {
    case 409:
      return 'FORM.ERROR_NAME_TAKEN';
    case 422:
      return 'FORM.ERROR_INVALID';
    case 401:
    case 403:
      return 'FORM.ERROR_SESSION';
    default:
      return 'FORM.ERROR_GENERIC';
  }
}
