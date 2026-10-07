import jwt from 'jsonwebtoken';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from './auth-session';
import type { BusinessPreset } from '@/types/pos';

/**
 * Mirrors backend/src/api/auth/services/auth.ts's AuthTokenPayload exactly —
 * the BFF verifies the same HS256 token with the same JWT_SECRET rather than
 * round-tripping to Strapi's /api/auth/me on every proxied request. This is
 * safe to do in a Route Handler (Node.js runtime, unlike middleware.ts which
 * runs on the Edge runtime and can't load `jsonwebtoken`).
 */
export interface SessionClaims {
  userId: string;
  tenantId: string;
  storeId: string;
  role: string;
  preset: BusinessPreset;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured on the BFF (must match the Strapi backend value)');
  return secret;
}

/** Returns the verified session, or null when the cookie is missing/expired/tampered. Never throws. */
export function readSession(request: NextRequest): SessionClaims | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret()) as unknown as SessionClaims;
  } catch {
    return null;
  }
}
