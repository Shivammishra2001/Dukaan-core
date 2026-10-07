'use client';

import { useEffect, useState } from 'react';
import { fetchMe } from '@/lib/auth-client';
import type { MeResponse } from '@/types/auth';

/** Thin client-side wrapper around GET /api/auth/me — the real JWT verification happens there (see middleware.ts's doc comment for why it isn't done here). */
export function useSession() {
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setProfile(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { profile, loading };
}
