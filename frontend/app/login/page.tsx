'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Eye, EyeOff, Loader2, Package, Receipt, Store } from 'lucide-react';
import { login, pinLogin, landingRouteForPreset } from '@/lib/auth-client';
import { PinPad } from '@/components/auth/pin-pad';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';

type Tab = 'owner' | 'cashier';

function OwnerForm({ onSuccess }: { onSuccess: (preset: string) => void }) {
  const { t } = useLanguage();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    const res = await login({ identifier: identifier.trim(), password });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error === 'ERR_INVALID_CREDENTIALS' ? t('auth.incorrectCredentials') : `${t('auth.couldNotLogIn')} (${translateError(t, res.error)}).`);
      return;
    }
    onSuccess(res.data.store.business_preset);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-semibold text-slate-700">{t('auth.phoneOrStoreCode')}</label>
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoFocus
          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-slate-700">{t('auth.password')}</label>
        <div className="relative mt-1.5">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type={showPassword ? 'text' : 'password'}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-11 text-sm font-medium text-slate-900 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition hover:shadow-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
      >
        {submitting && <Loader2 size={16} className="animate-spin" />}
        {submitting ? t('auth.loggingIn') : t('auth.logIn')}
      </button>
    </form>
  );
}

function CashierPinForm({ onSuccess }: { onSuccess: (preset: string) => void }) {
  const { t } = useLanguage();
  const [storeCode, setStoreCode] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!storeCode.trim() || pin.length < 4) return;
    setSubmitting(true);
    setError(null);
    const res = await pinLogin({ store_code: storeCode.trim(), pin });
    setSubmitting(false);
    if (!res.ok) {
      setError(t('auth.invalidPin'));
      setPin('');
      return;
    }
    onSuccess(res.data.store.business_preset);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-semibold text-slate-700">{t('auth.storeCode')}</label>
        <input
          value={storeCode}
          onChange={(e) => setStoreCode(e.target.value.toUpperCase())}
          placeholder={t('auth.storeCodePlaceholder')}
          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium uppercase tracking-wide text-slate-900 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700">{t('auth.enterPin')}</label>
          <div className="flex gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className={`h-2.5 w-2.5 rounded-full transition ${i < pin.length ? 'bg-primary' : 'bg-slate-200'}`} />
            ))}
          </div>
        </div>
        <PinPad value={pin} onChange={setPin} />
      </div>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || pin.length < 4 || !storeCode.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
      >
        {submitting && <Loader2 size={16} className="animate-spin" />}
        {submitting ? t('auth.checking') : t('auth.unlockCounter')}
      </button>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('owner');
  const { t } = useLanguage();

  function handleSuccess(preset: string) {
    const next = searchParams.get('next');
    router.push(next && next !== '/login' ? next : landingRouteForPreset(preset));
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setTab('owner')}
          className={`rounded-lg py-2.5 text-sm font-semibold transition ${tab === 'owner' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {t('auth.storeOwner')}
        </button>
        <button
          type="button"
          onClick={() => setTab('cashier')}
          className={`rounded-lg py-2.5 text-sm font-semibold transition ${tab === 'cashier' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {t('auth.cashierPin')}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-7">
        <h1 className="text-xl font-black text-slate-900">{tab === 'owner' ? t('dashboard.welcomeBack') : t('auth.quickCounterLogin')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tab === 'owner' ? t('auth.ownerHint') : t('auth.cashierHint')}
        </p>
        <div className="mt-5">{tab === 'owner' ? <OwnerForm onSuccess={handleSuccess} /> : <CashierPinForm onSuccess={handleSuccess} />}</div>
      </div>

      <p className="mt-5 text-center text-sm text-slate-500">
        {t('auth.newHere')}{' '}
        <a href="/register" className="font-semibold text-primary hover:underline">
          {t('auth.setUpBusiness')}
        </a>
      </p>
    </div>
  );
}

const SHOWCASE_ITEMS = [
  { icon: Store, labelKey: 'auth.showcase1' },
  { icon: Receipt, labelKey: 'auth.showcase2' },
  { icon: Package, labelKey: 'auth.showcase3' },
  { icon: BarChart3, labelKey: 'auth.showcase4' },
];

export default function LoginPage() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Branding showcase — desktop only */}
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-primary via-accent to-slate-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-indigo-400/20 blur-3xl" />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t('common.appName')}
          </span>
          <h2 className="mt-6 max-w-sm text-3xl font-black leading-tight text-white">{t('auth.tagline')}</h2>
        </div>

        {/* Live dashboard mockup */}
        <div className="relative mx-auto w-full max-w-sm rounded-2xl border border-white/20 bg-white/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400">{t('dashboard.kpiTodaySales')}</p>
              <p className="text-2xl font-black text-slate-900">₹48,320</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">+14%</span>
          </div>
          <div className="mt-3 flex items-end gap-1.5">
            {[40, 65, 50, 80, 60, 95, 70].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-primary to-accent" style={{ height: `${h * 0.5}px` }} />
            ))}
          </div>
        </div>

        <ul className="relative space-y-3">
          {SHOWCASE_ITEMS.map(({ icon: Icon, labelKey }) => (
            <li key={labelKey} className="flex items-center gap-3 text-sm font-medium text-white/90">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                <Icon size={16} />
              </span>
              {t(labelKey)}
            </li>
          ))}
        </ul>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="absolute right-4 top-4">
          <LanguageSwitcher />
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
