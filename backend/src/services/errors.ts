/** Generic domain error carrying an HTTP status + REQUIREMENTS.md §7.1-style error code, used by every custom service (checkout, shifts, onboarding). */
export class AppError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  resolutions?: Array<{ action: string; label: string; requires_permission?: string; payload_patch?: Record<string, unknown> }>;

  constructor(
    code: string,
    status: number,
    message?: string,
    opts?: { details?: Record<string, unknown>; resolutions?: AppError['resolutions'] }
  ) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = opts?.details;
    this.resolutions = opts?.resolutions;
  }
}

/** Postgres unique_violation (23505) on a specific named constraint. */
export function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  const pgErr = err as { code?: string; constraint?: string } | undefined;
  if (!pgErr || pgErr.code !== '23505') return false;
  return constraintName ? pgErr.constraint === constraintName : true;
}
