/**
 * Trackwork segmented tab group — exact match to PageHeader.tsx filters styling.
 * Same container + pill classes, used for standalone tab groups like table "Sort by".
 *
 * Props:
 *   value    — current selected value
 *   onChange — (value) => void
 *   options  — array of { value, label, count? }
 *   label    — optional small label rendered before the group (e.g. "Sort by:")
 */
export function SegmentedTabs({ value, onChange, options, label }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {label ? <span className="text-[13px] text-ink-500">{label}</span> : null}
      <div className="inline-flex items-center gap-px rounded-[6px] border border-ink-100 bg-ink-50 p-0.5">
        {options.map((opt) => {
          const isActive = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={
                'rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                (isActive
                  ? 'bg-ink-0 text-ink-900 shadow-[0_1px_2px_rgba(11,14,20,0.06)]'
                  : 'text-ink-500 hover:text-ink-900')
              }
            >
              {opt.label}
              {typeof opt.count === 'number' ? (
                <span
                  className={
                    'ml-1 text-[11px] ' + (isActive ? 'text-ink-500' : 'text-ink-400')
                  }
                >
                  {opt.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
