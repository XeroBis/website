import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { TransferSection } from '../../ui/transfer-section';
import { FileKind, WorkoutApi } from '../../workout/api';

/** Your own import/export, in the old app's file formats. */
@Component({
  selector: 'ab-data',
  imports: [TransferSection, TranslatePipe],
  template: `
    <h1>{{ 'nav.data' | translate }}</h1>
    <p class="muted">{{ 'data.intro' | translate }}</p>
    @for (kind of kinds; track kind) {
      <ab-transfer-section
        [heading]="'data.' + kind"
        [filename]="kind + '.json'"
        [shape]="kind"
        [fetch]="exporter(kind)"
        [send]="importer(kind)"
      />
    }
  `,
})
export class Data {
  private readonly api = inject(WorkoutApi);
  protected readonly kinds: FileKind[] = ['workouts', 'templates', 'circuits'];

  protected exporter(kind: FileKind) {
    return () => this.api.exportFile(kind);
  }

  protected importer(kind: FileKind) {
    return (data: unknown) => this.api.importFile(kind, data);
  }
}
