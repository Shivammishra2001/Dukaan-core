'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, EyeOff, Loader2, Scan, Scissors, Truck, UtensilsCrossed, Wrench, type LucideIcon } from 'lucide-react';
import { registerCompany, landingRouteForPreset } from '@/lib/auth-client';
import type { BusinessPreset } from '@/types/pos';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';

interface PresetOption {
  value: BusinessPreset;
  labelKey: string;
  hintKey: string;
  badgeKey: string;
  icon: LucideIcon;
  gradient: string;
}

const PRESETS: PresetOption[] = [
  { value: 'KIRANA', labelKey: 'register.presetKirana', hintKey: 'register.presetKiranaHint', badgeKey: 'register.presetKiranaBadge', icon: Scan, gradient: 'from-emerald-500 to-teal-600' },
  { value: 'SALOON', labelKey: 'register.presetSaloon', hintKey: 'register.presetSaloonHint', badgeKey: 'register.presetSaloonBadge', icon: Scissors, gradient: 'from-pink-500 to-rose-600' },
  { value: 'DHABA', labelKey: 'register.presetDhaba', hintKey: 'register.presetDhabaHint', badgeKey: 'register.presetDhabaBadge', icon: UtensilsCrossed, gradient: 'from-orange-500 to-amber-600' },
  { value: 'REPAIR', labelKey: 'register.presetRepair', hintKey: 'register.presetRepairHint', badgeKey: 'register.presetRepairBadge', icon: Wrench, gradient: 'from-slate-600 to-slate-800' },
  { value: 'DISTRIBUTOR', labelKey: 'register.presetDistributor', hintKey: 'register.presetDistributorHint', badgeKey: 'register.presetDistributorBadge', icon: Truck, gradient: 'from-primary to-accent' },
];

const INDIAN_STATES = [
  ['DL', 'Delhi'], ['UP', 'Uttar Pradesh'], ['MH', 'Maharashtra'], ['KA', 'Karnataka'], ['TN', 'Tamil Nadu'],
  ['GJ', 'Gujarat'], ['RJ', 'Rajasthan'], ['WB', 'West Bengal'], ['HR', 'Haryana'], ['PB', 'Punjab'],
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<1 | 2>(1);
  const [companyName, setCompanyName] = useState('');
  const [preset, setPreset] = useState<BusinessPreset | null>(null);
  const [city, setCity] = useState('');
  const [state, setState] = useState('DL');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step1Valid = companyName.trim().length > 0 && preset !== null;
  const step2Valid = ownerName.trim().length > 0 && /^\d{10}$/.test(phone) && password.length >= 8;

  async function handleSubmit() {
    if (!preset || !step2Valid) return;
    setSubmitting(true);
    setError(null);
    const res = await registerCompany({
      company_name: companyName.trim(),
      business_preset: preset,
      owner_name: ownerName.trim(),
      phone,
      password,
      city: city.trim() || undefined,
      state,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(
        res.error === 'ERR_PHONE_TAKEN'
          ? t('register.phoneTaken')
          : `${t('register.couldNotCreate')} (${translateError(t, res.error)}).`
      );
      return;
    }
    router.push(landingRouteForPreset(res.data.store.business_preset));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-xl">
        <div className="mb-3 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary shadow-sm ring-1 ring-primary/20">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {t('common.appName')}
          </span>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900">{t('auth.setUpBusiness')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('register.subtitle')}</p>
        </div>

        {/* Step indicator */}
        <div className="mx-auto mb-6 flex w-full max-w-xs items-center gap-2">
          {[1, 2].map((s) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
                  step >= s ? 'bg-gradient-to-br from-primary to-accent text-white shadow-sm shadow-primary/30' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {step > s ? <Check size={14} /> : s}
              </div>
              {s === 1 && <div className={`h-1 flex-1 rounded-full transition ${step > 1 ? 'bg-primary' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/50 transition-all duration-300 sm:p-8">
          {step === 1 && (
            <div key="step1" className="animate-fadeIn space-y-5">
              <div>
                <label className="text-sm font-semibold text-slate-700">{t('register.companyName')}</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t('register.companyPlaceholder')}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">{t('register.businessKind')}</label>
                <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {PRESETS.map((p) => {
                    const Icon = p.icon;
                    const active = preset === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPreset(p.value)}
                        className={`group relative flex min-h-[48px] items-start gap-3 rounded-xl border p-3.5 text-left transition active:scale-[0.98] ${
                          active ? 'border-primary bg-primary/10 ring-2 ring-primary shadow-lg shadow-primary/10' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${p.gradient} text-white shadow-sm`}>
                          <Icon size={18} strokeWidth={2.25} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold leading-tight text-slate-900">{t(p.labelKey)}</span>
                          <span className="mt-0.5 block text-xs leading-tight text-slate-500">{t(p.hintKey)}</span>
                          <span className="mt-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 group-hover:bg-white">
                            {t(p.badgeKey)}
                          </span>
                        </span>
                        {active && (
                          <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold text-slate-700">{t('register.city')}</label>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700">{t('register.state')}</label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
                  >
                    {INDIAN_STATES.map(([code]) => (
                      <option key={code} value={code}>
                        {t(`state.${code}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                disabled={!step1Valid}
                onClick={() => setStep(2)}
                className="w-full rounded-xl bg-gradient-to-r from-primary to-accent py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition hover:shadow-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
              >
                {t('register.continue')}
              </button>
            </div>
          )}

          {step === 2 && (
            <div key="step2" className="animate-fadeIn space-y-5">
              <div>
                <label className="text-sm font-semibold text-slate-700">{t('register.yourName')}</label>
                <input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  autoFocus
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">{t('register.phoneNumber')}</label>
                <div className="mt-1.5 flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition focus-within:border-primary focus-within:bg-white focus-within:ring-4 focus-within:ring-primary/10">
                  <span className="flex items-center gap-1.5 border-r border-slate-200 bg-slate-100/80 px-3 text-sm font-semibold text-slate-600">
                    🇮🇳 +91
                  </span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    inputMode="numeric"
                    placeholder={t('register.phonePlaceholder')}
                    className="w-full bg-transparent px-3 py-3 text-sm font-medium text-slate-900 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">{t('auth.password')}</label>
                <div className="relative mt-1.5">
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('register.passwordPlaceholder')}
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

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-slate-200 px-5 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  disabled={!step2Valid || submitting}
                  onClick={handleSubmit}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition hover:shadow-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {submitting ? t('register.creating') : t('register.createAccount')}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-sm text-slate-500">
          {t('register.haveAccount')}{' '}
          <a href="/login" className="font-semibold text-primary hover:underline">
            {t('auth.logIn')}
          </a>
        </p>
      </div>
    </div>
  );
}
