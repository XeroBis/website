import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { CardSet, Share } from '../../models/card.model';
import { SharesService } from '../../services/shares.service';
import { CatalogService } from '../../services/catalog.service';
import { httpErrorMessage as errorMessage } from '@shared';
@Component({
  selector: 'app-shares',
  imports: [DatePipe, FormsModule, TranslatePipe],
  template: `
    <h1>{{ 'nav.shares' | translate }}</h1>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    <form class="filters" (ngSubmit)="create()">
      <label
        >{{ 'nav.sets' | translate
        }}<select name="set" [(ngModel)]="setCode" required>
          @for (set of sets(); track set.set_code) {
            <option [value]="set.set_code">{{ set.set_name }}</option>
          }
        </select></label
      >
      <label
        >{{ 'share.duration' | translate
        }}<select name="duration" [(ngModel)]="duration">
          @for (days of durations; track days) {
            <option [ngValue]="days">{{ days }}</option>
          }
        </select></label
      >
      <button class="btn btn-primary" [disabled]="busy() || !setCode">
        {{ 'share.create' | translate }}
      </button>
    </form>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ 'nav.sets' | translate }}</th>
            <th>{{ 'share.expires' | translate }}</th>
            <th>{{ 'share.status' | translate }}</th>
            <th>{{ 'share.link' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (share of shares(); track share.id) {
            <tr>
              <td>{{ share.set_name }}</td>
              <td>{{ share.expires_at | date: 'short' }}</td>
              <td>{{ 'share.' + share.status | translate }}</td>
              <td>
                @if (share.status === 'active') {
                  <a [href]="api.shareUrl(share.token)">{{ 'share.link' | translate }}</a>
                  <button class="btn btn-secondary" [disabled]="busy()" (click)="revoke(share.id)">
                    {{ 'share.revoke' | translate }}
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class SharesComponent {
  readonly api = inject(SharesService);
  private readonly catalog = inject(CatalogService);
  readonly shares = signal<Share[]>([]);
  readonly sets = signal<CardSet[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly durations = [1, 3, 7, 30];
  setCode = '';
  duration: 1 | 3 | 7 | 30 = 7;
  constructor() {
    void this.load();
  }
  private async load() {
    try {
      const [shares, sets] = await Promise.all([
        firstValueFrom(this.api.list()),
        firstValueFrom(this.catalog.listSets()),
      ]);
      this.shares.set(shares);
      this.sets.set(sets);
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
  async create() {
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api.create({ set_code: this.setCode, duration_days: this.duration }),
      );
      await this.load();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  async revoke(id: number) {
    this.busy.set(true);
    this.error.set('');
    try {
      const share = await firstValueFrom(this.api.revoke(id));
      this.shares.update((rows) => rows.map((row) => (row.id === id ? share : row)));
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
