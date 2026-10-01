/**
 * Trackwork KpiCard: no card wrapper — just label + large mono value + delta row.
 *
 * Props:
 *   label    — uppercase title (required)
 *   value    — pre-formatted string/number to display (required)
 *   current  — OPTIONAL raw numeric for delta math. If omitted, we parse `value`
 *              by stripping non-digit characters. Pass this explicitly whenever
 *              `value` is formatted with currency/percent/locale symbols, because
 *              parseFloat("$824.96") returns NaN.
 *   subtext  — optional description below the delta row
 *   previous — optional previous-period value; when present, renders a delta %
 *   reverseTrendColors — for metrics where "down is good" (churn, cancellation)
 *   rangeLabel — label for the comparison window, e.g. "30d"
 */
function parseNumeric(value) {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  const stripped = String(value).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(stripped);
  return Number.isFinite(n) ? n : 0;
}

export function StatCard({
  label,
  value,
  current,
  subtext,
  previous,
  reverseTrendColors = false,
  rangeLabel,
}) {
  const currentNum = current !== undefined ? current : parseNumeric(value);
  const hasDelta = previous !== undefined && previous !== null && previous !== 0 && currentNum !== 0;
  const change = hasDelta ? ((currentNum - previous) / previous) * 100 : 0;
  const isPositive = change > 0;
  const good = reverseTrendColors ? !isPositive : isPositive;
  const deltaColor = good ? 'text-success' : 'text-danger';

  return (
    <div className="py-1">
      <div className="text-[11px] font-medium uppercase tracking-micro text-ink-500 mb-3">
        {label}
      </div>
      <div className="font-num text-[34px] leading-none font-medium text-ink-900">
        {value}
      </div>
      {(hasDelta || rangeLabel || subtext) ? (
        <div className="mt-3 flex items-baseline gap-2 text-[12px] leading-none">
          {hasDelta ? (
            <span className={`font-num tnum font-medium ${deltaColor}`}>
              {isPositive ? '+' : ''}
              {change.toFixed(1)}%
            </span>
          ) : (
            <span className="text-ink-400">—</span>
          )}
          {(rangeLabel || subtext) ? (
            <span className="text-ink-400 tnum">
              {rangeLabel ? `vs ${rangeLabel}` : null}
              {rangeLabel && subtext ? ' · ' : ''}
              {subtext ? (
                <span className={rangeLabel ? 'text-ink-400' : ''}>{subtext}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
