'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { MobileHeader } from '@/components/layout/MobileHeader';

/**
 * Persistent responsive shell for every authenticated route (/dashboard,
 * /pos, /b2b/*, /customers/*, /inventory/*, /reports/*). A Client Component
 * layout can still render Server Component pages as `children` — Next.js
 * renders the page server-side and passes the result down, so wrapping it
 * here doesn't force any page onto the client.
 */
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Safety net for programmatic navigation that doesn't go through a NavItem's onClick.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <AppSidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
