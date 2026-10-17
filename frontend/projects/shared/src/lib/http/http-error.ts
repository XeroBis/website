import { HttpErrorResponse } from '@angular/common/http';

/** The HTTP status of a failed request, 0 for anything else (e.g. offline). */
export function httpStatus(err: unknown): number {
  return err instanceof HttpErrorResponse ? err.status : 0;
}
