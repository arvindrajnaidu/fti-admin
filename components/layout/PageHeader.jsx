/**
 * Trackwork PageHeader — exact port of trackwork-internal/src/components/PageHeader.tsx
 * (22px semibold title, 13px subtitle, optional ink-400 icon, segmented filter pills).
 *
 * Props:
 *   title    — required
 *   subtitle — optional descriptor
 *   icon     — optional React component (phosphor icon) rendered at ink-400
 *   actions  — optional right-aligned node
 *   filters  — optional { active, options: string[], onChange? } for top-right filter pills
 */
export function PageHeader({ title, subtitle, icon: Icon, actions, filters }) {
  return (
    <div className="mb-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {Icon ? (
            <Icon
              className="mt-1.5 h-[18px] w-[18px] shrink-0 text-ink-400"
              weight="regular"
            />
          ) : null}
          <div>
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink-900">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1.5 text-[13px] text-ink-500">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      {filters ? (
        <div className="mt-5 inline-flex items-center gap-px rounded-[6px] border border-ink-100 bg-ink-50 p-0.5">
          {filters.options.map((option) => {
            const active = filters.active === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => filters.onChange?.(option)}
                className={
                  'rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                  (active
                    ? 'bg-ink-0 text-ink-900 shadow-[0_1px_2px_rgba(11,14,20,0.06)]'
                    : 'text-ink-500 hover:text-ink-900')
                }
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
