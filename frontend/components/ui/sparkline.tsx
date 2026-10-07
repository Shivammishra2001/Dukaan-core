/** Inline-SVG trend line, no charting library — keeps the dashboard bundle light. Purely decorative (not tied to real time-series data yet). */
export function Sparkline({ points, tone = '#059669' }: { points: number[]; tone?: string }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * h).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
