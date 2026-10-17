import { HttpClient } from '@angular/common/http';
import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  model,
  signal,
  WritableSignal,
  viewChildren,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { MuscleIntensity, NameCount } from '../workout/models';

/** The body SVGs' group ids → muscle names (see domains/workout/muscles.py). */
export const SVG_MUSCLES: Record<string, string> = {
  abdominals: 'Abdominals',
  biceps: 'Biceps',
  calves: 'Calves',
  chest: 'Chest',
  forearms: 'Forearms',
  'front-shoulders': 'Front shoulders',
  obliques: 'Obliques',
  quads: 'Quads',
  traps: 'Traps',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  lats: 'Lats',
  lowerback: 'Lower back',
  'rear-shoulders': 'Rear shoulders',
  'traps-middle': 'Traps middle',
  triceps: 'Triceps',
};

/** Our own static files, but stripped of scripts and handlers all the same. */
export function sanitizeSvg(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.querySelector('parsererror')) return '';
  root.querySelectorAll('script, foreignObject').forEach((el) => el.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const value = attr.value.trim().toLowerCase();
      if (attr.name.toLowerCase().startsWith('on') || value.startsWith('javascript:'))
        el.removeAttribute(attr.name);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

// Fetched once per page load, shared by every map.
const svgCache = new Map<string, Promise<string>>();

/** Next intensity on click in edit mode: 1 → 2 → 3 → off. */
export function cycle(muscles: MuscleIntensity[], name: string, toggle: boolean): MuscleIntensity[] {
  const current = muscles.find((m) => m.name === name);
  if (!current) return [...muscles, { name, intensity: 1 }];
  if (toggle || current.intensity >= 3) return muscles.filter((m) => m.name !== name);
  return muscles.map((m) => (m.name === name ? { ...m, intensity: m.intensity + 1 } : m));
}

/**
 * Front and back body maps, muscles shaded by intensity (1–3).
 * `edit`: a click cycles 1 → 2 → 3 → off; `toggle`: on/off (filters);
 * `readonly`: hovering/tapping a muscle lists `exercises[muscle]`.
 */
@Component({
  selector: 'ab-muscle-map',
  imports: [TranslatePipe],
  host: { '[class]': '"muscle-map " + mode()' },
  template: `
    <div
      class="bodies"
      (click)="click($event)"
      (mousemove)="hover($event)"
      (mouseleave)="hovered.set(null)"
    >
      <div #body class="body" [innerHTML]="front()"></div>
      <div #body class="body" [innerHTML]="back()"></div>
    </div>
    @if (hovered(); as name) {
      <div class="muscle-tip" [style.left.px]="tip().x" [style.top.px]="tip().y" data-testid="muscle-tip">
        <strong>{{ 'muscle.' + name | translate }}</strong>
        @for (e of exercises()[name] ?? []; track e.name) {
          <span>{{ e.name }} × {{ e.count }}</span>
        }
      </div>
    }
    @if (showList()) {
      <div class="muscle-tags">
        @for (m of muscles(); track m.name) {
          <button
            type="button"
            class="muscle-tag"
            [attr.data-intensity]="m.intensity"
            [disabled]="mode() === 'readonly'"
            (click)="remove(m.name)"
          >
            {{ 'muscle.' + m.name | translate }}
            <span class="dots">
              @for (i of [1, 2, 3]; track i) {
                <span class="dot" [class.on]="i <= m.intensity"></span>
              }
            </span>
          </button>
        } @empty {
          @if (mode() === 'edit') {
            <span class="hint">{{ 'muscleMap.hint' | translate }}</span>
          }
        }
      </div>
    }
  `,
})
export class MuscleMap {
  readonly muscles = model<MuscleIntensity[]>([]);
  readonly mode = input<'edit' | 'toggle' | 'readonly'>('readonly');
  readonly exercises = input<Record<string, NameCount[]>>({});
  /** The list of selected muscles under the map (edit mode always shows it). */
  readonly list = input(false);

  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly front = signal<SafeHtml>('');
  protected readonly back = signal<SafeHtml>('');
  private readonly bodies = viewChildren<ElementRef<HTMLElement>>('body');
  protected readonly hovered = signal<string | null>(null);
  protected readonly tip = signal({ x: 0, y: 0 });
  protected readonly showList = computed(() => this.list() || this.mode() === 'edit');

  constructor() {
    this.load('front.svg', this.front);
    this.load('back.svg', this.back);
    // Shade the SVG groups whenever the SVGs or the muscles change.
    afterRenderEffect(() => {
      const byName = new Map(this.muscles().map((m) => [m.name, m.intensity]));
      this.front();
      this.back();
      for (const body of this.bodies()) {
        for (const g of body.nativeElement.querySelectorAll<SVGGElement>('g[id]')) {
          const name = SVG_MUSCLES[g.id];
          if (!name) continue;
          g.classList.add('muscle');
          g.classList.remove('i1', 'i2', 'i3');
          const intensity = byName.get(name);
          if (intensity) g.classList.add(`i${intensity}`);
        }
      }
    });
  }

  private load(file: string, target: WritableSignal<SafeHtml>): void {
    if (!svgCache.has(file)) {
      svgCache.set(file, firstValueFrom(this.http.get(`/${file}`, { responseType: 'text' })));
    }
    svgCache
      .get(file)!
      .then((raw) => target.set(this.sanitizer.bypassSecurityTrustHtml(sanitizeSvg(raw))))
      .catch(() => svgCache.delete(file));
  }

  private muscleAt(event: Event): string | null {
    const group = (event.target as Element).closest?.('g[id]');
    return group ? (SVG_MUSCLES[group.id] ?? null) : null;
  }

  protected click(event: MouseEvent): void {
    const name = this.muscleAt(event);
    if (!name) return;
    if (this.mode() === 'readonly') return this.hover(event);
    this.muscles.set(cycle(this.muscles(), name, this.mode() === 'toggle'));
  }

  protected hover(event: MouseEvent): void {
    if (this.mode() !== 'readonly') return;
    const name = this.muscleAt(event);
    const worked = name && this.muscles().some((m) => m.name === name);
    this.hovered.set(worked ? name : null);
    this.tip.set({ x: event.clientX + 12, y: event.clientY + 12 });
  }

  protected remove(name: string): void {
    if (this.mode() !== 'readonly') this.muscles.set(this.muscles().filter((m) => m.name !== name));
  }
}
