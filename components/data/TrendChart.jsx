/**
 * Trackwork-style dual line chart for time-series KPI data.
 * Pure SVG, no echarts dependency.
 *
 * Props:
 *   data      — array of buckets (current period), each with { label, ...values }
 *   prior     — optional array of buckets (prior period, same length as `data`)
 *   valueKey  — field on each bucket to plot
 *   format    — optional (value) => displayString for hover tooltip
 *   tone      — 'accent' | 'success' | 'ink' (current-line color)
 *   height    — chart area height in px (default 160)
 */
export function TrendChart({
  data,
  prior,
  valueKey,
  format = (v) => v.toLocaleString(),
  tone = 'accent',
  height = 160,
}) {
  const current = data.map((d) => Number(d[valueKey]) || 0);
  const priorValues = prior ? prior.map((d) => Number(d[valueKey]) || 0) : [];
  const max = Math.max(1, ...current, ...priorValues);
  const n = data.length;

  // Use a fixed viewBox — width scales to container, preserveAspectRatio=none
  // stretches the line horizontally while keeping vertical proportions.
  const VB_W = 1000;
  const VB_H = 200;
  const PAD_X = 12;
  const PAD_Y = 16;
  const innerW = VB_W - PAD_X * 2;
  const innerH = VB_H - PAD_Y * 2;

  const toneStroke =
    tone === 'success' ? 'var(--success-fg)'
    : tone === 'ink'   ? 'var(--ink-900)'
    :                    'var(--accent)';

  const x = (i) => PAD_X + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => PAD_Y + innerH - (v / max) * innerH;

  const buildPath = (series) => {
    if (!series || series.length === 0) return '';
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
      .join(' ');
  };

  const currentPath = buildPath(current);
  const priorPath = priorValues.length ? buildPath(priorValues) : '';

  // Build a subtle horizontal baseline grid (min + mid + max markers).
  const gridYs = [0, 0.5, 1].map((t) => PAD_Y + innerH * (1 - t));

  return (
    <div className="w-full">
      <div className="relative w-full" style={{ height }}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          {/* Horizontal grid */}
          {gridYs.map((gy, i) => (
            <line
              key={i}
              x1={PAD_X}
              x2={VB_W - PAD_X}
              y1={gy}
              y2={gy}
              stroke="var(--ink-100)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Prior period — lighter, dashed */}
          {priorPath ? (
            <path
              d={priorPath}
              fill="none"
              stroke="var(--ink-300)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {/* Current period */}
          <path
            d={currentPath}
            fill="none"
            stroke={toneStroke}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Current period dots */}
          {current.map((v, i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r="3"
              fill="var(--ink-0)"
              stroke={toneStroke}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${data[i]?.label}: ${format(v)}`}</title>
            </circle>
          ))}
        </svg>
      </div>

      {/* X-axis labels */}
      <div className="mt-2 flex text-[10px] text-ink-400">
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 justify-center truncate">
            {d.label}
          </div>
        ))}
      </div>

      {/* Legend */}
      {prior && prior.length > 0 ? (
        <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ backgroundColor: toneStroke }}
            />
            Current
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full border-t border-dashed border-ink-300"
              style={{ borderTopStyle: 'dashed', backgroundColor: 'transparent' }}
            />
            Prior period
          </span>
        </div>
      ) : null}
    </div>
  );
}
