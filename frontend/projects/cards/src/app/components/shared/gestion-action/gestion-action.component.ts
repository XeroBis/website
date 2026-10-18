import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-gestion-action',
  imports: [],
  templateUrl: './gestion-action.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './gestion-action.component.scss',
})
export class GestionActionComponent {
  @Input() actionTitle = '';
  @Input() description = '';
}
