import { Component, computed, inject, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import { ConfirmButton } from '../../ui/confirm-button';
import { DetailsModal } from '../../ui/details-modal';
import { EntryList } from '../../ui/entry-list';
import { HistoryModal } from '../../ui/history-modal';
import { ViewingSelect } from '../../ui/viewing-select';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { matchesTemplate } from '../../workout/format';
import { Exercise, Template } from '../../workout/models';
import { Viewing } from '../../workout/viewing';

/**
 * The viewed user's templates, collapsed to their name until opened, with a
 * search: yours to edit, start or delete; others' to copy.
 */
@Component({
  selector: 'ab-templates',
  imports: [ConfirmButton, DetailsModal, EntryList, HistoryModal, Icon, RouterLink, TranslatePipe, ViewingSelect],
  providers: [Viewing],
  template: `
    <div class="toolbar">
      <ab-viewing-select />
      <input
        type="search"
        id="template-search"
        class="search"
        data-testid="template-search"
        [attr.aria-label]="'templates.search' | translate"
        [placeholder]="'templates.search' | translate"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
      @if (viewing.isOwn()) {
        <a class="btn primary push" routerLink="/templates/new"><ab-icon name="plus" /> {{ 'templates.new' | translate }}</a>
      }
    </div>
    @if (message(); as m) {
      <p [class]="m.ok ? 'success' : 'error'" data-testid="message">{{ m.text | translate: m.params }}</p>
    }
    @for (t of shown(); track t.id) {
      @let isOpen = expanded().has(t.id);
      <article class="card workout-card" data-testid="template">
        <header class="workout-head" [class.collapsed]="!isOpen">
          <button
            type="button"
            class="template-toggle"
            data-testid="template-toggle"
            [attr.aria-expanded]="isOpen"
            (click)="toggle(t.id)"
          >
            <ab-icon [name]="isOpen ? 'chevron-down' : 'chevron-right'" />
            <span class="workout-date">{{ t.name }}</span>
          </button>
          <span class="workout-duration">{{ 'templates.entries' | translate: { n: t.exercises.length } }}</span>
          <span class="push"></span>
          <button type="button" class="btn ghost sm" (click)="details.set(t)"><ab-icon name="info" /> {{ 'common.details' | translate }}</button>
          @if (viewing.isOwn()) {
            <button type="button" class="btn accent sm" (click)="start(t)"><ab-icon name="play" /> {{ 'templates.start' | translate }}</button>
            <a class="btn ghost sm" [routerLink]="['/templates', t.id]"><ab-icon name="pencil" /> {{ 'common.edit' | translate }}</a>
            <ab-confirm-button label="common.delete" (confirmed)="remove(t)" />
          } @else {
            <button type="button" class="btn primary sm" data-testid="copy" (click)="copy(t)">
              <ab-icon name="copy" /> {{ 'templates.copy' | translate }}
            </button>
          }
        </header>
        @if (isOpen) {
          <ab-entry-list [entries]="t.exercises" (exerciseClicked)="history.set($event)" />
        }
      </article>
    } @empty {
      @if (templates.value()?.length) {
        <p class="empty">{{ 'templates.noMatch' | translate }}</p>
      } @else if (templates.hasValue()) {
        <p class="empty">{{ 'templates.empty' | translate }}</p>
      }
    }
    @if (templates.isLoading()) {
      <p class="muted">{{ 'common.loading' | translate }}</p>
    }
    @if (details(); as t) {
      <ab-details-modal [heading]="t.name" [entries]="t.exercises" (closed)="details.set(null)" />
    }
    @if (history(); as ex) {
      <ab-history-modal [exercise]="ex" [userId]="viewing.queryUserId()" (closed)="history.set(null)" />
    }
  `,
})
export class Templates {
  private readonly api = inject(WorkoutApi);
  private readonly router = inject(Router);
  protected readonly viewing = inject(Viewing);
  protected readonly templates = resource({
    params: () => ({ user: this.viewing.queryUserId() }),
    loader: ({ params }) => this.api.templates(params.user),
  });
  protected readonly query = signal('');
  protected readonly shown = computed(() =>
    (this.templates.value() ?? []).filter((t) => matchesTemplate(t, this.query())),
  );
  /** Opened templates; the others show only their header. */
  protected readonly expanded = signal(new Set<number>());
  protected readonly details = signal<Template | null>(null);
  protected readonly history = signal<Exercise | null>(null);
  protected readonly message = signal<{ ok: boolean; text: string; params?: object } | null>(null);

  protected toggle(id: number): void {
    const next = new Set(this.expanded());
    if (!next.delete(id)) next.add(id);
    this.expanded.set(next);
  }

  protected async remove(t: Template): Promise<void> {
    try {
      await this.api.deleteTemplate(t.id);
      this.templates.reload();
    } catch (e) {
      this.message.set({ ok: false, text: errorMessage(e) });
    }
  }

  protected async copy(t: Template): Promise<void> {
    try {
      const copy = await this.api.copyTemplate(t.id, this.viewing.userId()!);
      this.message.set({ ok: true, text: 'templates.copied', params: { name: copy.name } });
    } catch (e) {
      this.message.set({ ok: false, text: errorMessage(e) });
    }
  }

  protected async start(t: Template): Promise<void> {
    try {
      await this.api.startSession(t.id);
      await this.router.navigateByUrl('/session');
    } catch (e) {
      this.message.set({ ok: false, text: errorMessage(e) });
    }
  }
}
