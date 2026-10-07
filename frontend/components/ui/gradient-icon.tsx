import type { LucideIcon } from 'lucide-react';

const GRADIENTS = {
  blue: 'from-blue-600 to-indigo-600',
  emerald: 'from-emerald-500 to-emerald-600',
  amber: 'from-amber-500 to-amber-600',
  rose: 'from-rose-500 to-rose-600',
  slate: 'from-slate-500 to-slate-600',
} as const;

interface GradientIconProps {
  icon: LucideIcon;
  tone?: keyof typeof GRADIENTS;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { box: 'h-9 w-9 rounded-lg', icon: 16 },
  md: { box: 'h-11 w-11 rounded-xl', icon: 20 },
  lg: { box: 'h-14 w-14 rounded-2xl', icon: 26 },
};

/** Shared gradient-badge icon used across the dashboard action grid, KPI cards and auth screens. */
export function GradientIcon({ icon: Icon, tone = 'blue', size = 'md' }: GradientIconProps) {
  const s = SIZES[size];
  return (
    <span className={`flex shrink-0 items-center justify-center bg-gradient-to-br ${GRADIENTS[tone]} text-white shadow-sm ${s.box}`}>
      <Icon size={s.icon} strokeWidth={2.25} />
    </span>
  );
}
