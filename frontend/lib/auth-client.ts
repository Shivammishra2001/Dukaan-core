import type { AuthProfile, LoginRequest, MeResponse, PinLoginRequest, RegisterCompanyRequest } from '@/types/auth';
import type { ApiErrorBody } from '@/types/checkout';

export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function post<T>(path: string, body: unknown): Promise<AuthResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  return { ok: true, data: (payload as { data: T }).data };
}

export function registerCompany(request: RegisterCompanyRequest): Promise<AuthResult<AuthProfile>> {
  return post('/api/auth/register-company', request);
}

export function login(request: LoginRequest): Promise<AuthResult<AuthProfile>> {
  return post('/api/auth/login', request);
}

export function pinLogin(request: PinLoginRequest): Promise<AuthResult<AuthProfile>> {
  return post('/api/auth/pin-login', request);
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export async function fetchMe(): Promise<AuthResult<MeResponse>> {
  let res: Response;
  try {
    res = await fetch('/api/auth/me', { cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  return { ok: true, data: (payload as { data: MeResponse }).data };
}

/** POS/SALOON/DHABA/REPAIR land on the counter; DISTRIBUTOR lands on the management hub — same split app/dashboard/page.tsx's nav grid describes. */
export function landingRouteForPreset(preset: string): string {
  return preset === 'DISTRIBUTOR' ? '/dashboard' : '/pos';
}
