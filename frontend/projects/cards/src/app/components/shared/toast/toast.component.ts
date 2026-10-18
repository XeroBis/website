import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Toast, ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-toast',
  imports: [TranslatePipe],
  templateUrl: './toast.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './toast.component.scss',
})
export class ToastComponent {
  get toasts(): Toast[] {
    return this.toastService.toasts();
  }

  constructor(private readonly toastService: ToastService) {}

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
