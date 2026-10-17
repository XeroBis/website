import { HttpErrorResponse } from '@angular/common/http';

export function httpStatus(err: unknown): number {
  return err instanceof HttpErrorResponse ? err.status : 0;
}
