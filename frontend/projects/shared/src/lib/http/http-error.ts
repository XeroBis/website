import { HttpErrorResponse } from '@angular/common/http';

/** The HTTP status of a failed request, 0 for anything else (e.g. offline). */
export function httpStatus(err: unknown): number {
  return err instanceof HttpErrorResponse ? err.status : 0;
}

/** Display FastAPI business refusals and field-level validation failures. */
export function httpErrorMessage(error: unknown): string {
  const value = error as { error?: { detail?: unknown }; message?: string };
  const detail = value?.error?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => `${e.loc?.join('.') ?? ''}: ${e.msg ?? ''}`).join('\n');
  return value?.message ?? String(error);
}
