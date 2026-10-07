'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, LogOut, Store, X, type LucideIcon } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { useLanguage } from '@/context/LanguageContext';
import { logout } from '@/lib/auth-client';
import { clearSessionScope } from '@/lib/session-scope';
import { NAV_GROUPS, type NavLink } from '@/lib/nav-config';
import { translateEnum } from '@/lib/translations';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { ThemePicker } from '@/components/ui/ThemePicker';

const COLLAPSE_STORAGE_KEY = 'dukaan_sidebar_collapsed';

interface AppSidebarProps {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

/** 'rail' = the persistent md+ column, where label visibility is breakpoint-driven (tablet always icon-only, desktop toggles with `collapsed`). 'drawer' = the mobile off-canvas panel, which only ever renders below 768px and always shows full labels. */
type Variant = 'rail' | 'drawer';

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  link,
  active,
  variant,
  collapsed,
  onNavigate,
}: {
  link: NavLink;
  active: boolean;
  variant: Variant;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon: LucideIcon = link.icon;
  const { t, language } = useLanguage();
  const displayLabel = link.navKey ? t(link.navKey) : link.label;
  const showLabel = variant === 'drawer' || !collapsed;
  const labelClass = variant === 'drawer' ? 'truncate' : 'hidden truncate lg:inline';
  const showTooltip = variant === 'rail';

  return (
    <a
      href={link.href}
      onClick={onNavigate}
      className={`group relative flex min-h-[48px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
        active
          ? 'border-r-4 border-primary bg-primary/10 font-semibold text-primary'
          : 'border-r-4 border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      } ${variant === 'rail' ? 'md:justify-center md:px-0 lg:justify-start lg:px-3' : ''} ${
        variant === 'rail' && collapsed ? 'lg:justify-center lg:px-0' : ''
      }`}
    >
      <span className="relative flex shrink-0 items-center justify-center">
        <Icon size={20} strokeWidth={active ? 2.4 : 2} />
        {link.badge === 'live' && (
          <span className="absolute -right-1 -top-1 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        )}
      </span>
      {showLabel && (
        <span className={labelClass}>
          {displayLabel}
          {link.badge === 'live' && (
            <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              {t('nav.live')}
            </span>
          )}
        </span>
      )}
      {showTooltip && (
        <span
          className={`pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 md:block ${
            collapsed ? 'lg:block' : 'lg:hidden'
          }`}
        >
          {displayLabel}
          {language === 'en' && <span className="text-slate-400"> · {link.labelLocal}</span>}
        </span>
      )}
    </a>
  );
}

function SidebarHeader({ variant, collapsed }: { variant: Variant; collapsed: boolean }) {
  const { profile, loading } = useSession();
  const { t } = useLanguage();
  const showDetails = variant === 'drawer' || !collapsed;
  const detailsClass = variant === 'drawer' ? 'min-w-0' : 'hidden min-w-0 lg:block';

  return (
    <div
      className={`flex items-center gap-3 border-b border-slate-200 px-4 py-4 ${
        variant === 'rail' ? 'md:justify-center md:px-2 lg:justify-start lg:px-4' : ''
      } ${variant === 'rail' && collapsed ? 'lg:justify-center lg:px-2' : ''}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-sm">
        <Store size={18} strokeWidth={2.25} />
      </span>
      {showDetails && (
        <div className={detailsClass}>
          <p className="truncate text-sm font-bold text-slate-900">{loading ? t('common.loading') : profile?.store.name ?? t('common.appName')}</p>
          {profile && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="truncate rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {translateEnum(t, 'enum.preset', profile.store.business_preset)}
              </span>
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            <span className="relative flex h-1.5 w-1.5">
              {profile?.active_shift && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${profile?.active_shift ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            </span>
            <span className={profile?.active_shift ? 'font-medium text-emerald-700' : 'text-slate-400'}>
              {profile?.active_shift ? t('nav.shiftLive') : t('nav.noShiftOpen')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarFooter({ variant, collapsed, onLogout }: { variant: Variant; collapsed: boolean; onLogout: () => void }) {
  const { profile } = useSession();
  const { t } = useLanguage();
  const showPill = variant === 'drawer' || !collapsed;

  return (
    <div className="border-t border-slate-200 p-3">
      {showPill && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <LanguageSwitcher compact />
          <ThemePicker />
        </div>
      )}
      <div className={`flex items-center gap-2 ${variant === 'rail' ? 'md:flex-col lg:flex-row' : ''} ${variant === 'rail' && collapsed ? 'lg:flex-col' : ''}`}>
        {profile && showPill && (
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
              {profile.user.full_name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">{profile.user.full_name}</p>
              <p className="truncate text-[10px] text-slate-500">{translateEnum(t, 'enum.role', profile.role)}</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onLogout}
          title={t('common.logout')}
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-600"
        >
          <LogOut size={15} />
          {showPill && <span>{t('common.logout')}</span>}
        </button>
      </div>
    </div>
  );
}

function SidebarNav({
  variant,
  collapsed,
  pathname,
  onNavigate,
}: {
  variant: Variant;
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useLanguage();
  const showGroupTitle = variant === 'drawer' || !collapsed;
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          {showGroupTitle && (
            <p className={`px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 ${variant === 'rail' ? 'hidden lg:block' : ''}`}>
              {group.titleKey ? t(group.titleKey) : group.title}
            </p>
          )}
          <div className="space-y-0.5">
            {group.links.map((link) => (
              <NavItem key={link.href} link={link} active={isActive(pathname, link.href)} variant={variant} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar({ mobileOpen, onMobileOpenChange }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isPos = pathname.startsWith('/pos');
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (isPos) {
      setCollapsed(true);
      return;
    }
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored !== null) setCollapsed(stored === '1');
    } catch {
      /* localStorage unavailable (private mode) — keep the default */
    }
  }, [isPos]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function handleLogout() {
    await logout();
    clearSessionScope();
    router.push('/login');
  }

  return (
    <>
      {/* Desktop (>=1024px, collapsible) + tablet (768-1023px, always icon-only) persistent rail */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex md:w-20 ${
          collapsed ? 'lg:w-20' : 'lg:w-64'
        }`}
      >
        <SidebarHeader variant="rail" collapsed={collapsed} />
        <SidebarNav variant="rail" collapsed={collapsed} pathname={pathname} />
        <div className="hidden border-t border-slate-200 px-2.5 py-2 lg:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            {!collapsed && <span>{t('nav.collapse')}</span>}
          </button>
        </div>
        <SidebarFooter variant="rail" collapsed={collapsed} onLogout={handleLogout} />
      </aside>

      {/* Mobile (<768px) off-canvas drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label={t('nav.closeMenu')}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => onMobileOpenChange(false)}
          />
          <aside className="animate-fadeIn absolute inset-y-0 left-0 flex w-72 max-w-[82vw] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
              <span className="text-sm font-bold text-slate-900">{t('nav.menu')}</span>
              <button
                type="button"
                aria-label={t('nav.closeMenu')}
                onClick={() => onMobileOpenChange(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>
            <SidebarHeader variant="drawer" collapsed={false} />
            <SidebarNav variant="drawer" collapsed={false} pathname={pathname} onNavigate={() => onMobileOpenChange(false)} />
            <SidebarFooter variant="drawer" collapsed={false} onLogout={handleLogout} />
          </aside>
        </div>
      )}
    </>
  );
}
