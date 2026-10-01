/**
 * Trackwork-style table primitives. Plain HTML table, no card wrapper, no outer
 * border — just uppercase micro-tracked headers and hairline row separators.
 *
 * Usage:
 *   <TableShell>
 *     <thead>
 *       <tr><Th>Code</Th><Th align="right">Amount</Th></tr>
 *     </thead>
 *     <tbody>
 *       <Tr>
 *         <Td>HOLI25</Td>
 *         <Td align="right" className="font-num">$25.00</Td>
 *       </Tr>
 *     </tbody>
 *   </TableShell>
 */
export function TableShell({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="min-w-full border-collapse">{children}</table>
    </div>
  );
}

export function Th({ children, className = '', align = 'left' }) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`border-b border-ink-200 px-3 py-2 ${alignClass} text-[10px] font-medium uppercase tracking-micro text-ink-500 select-none ${className}`}
    >
      {children}
    </th>
  );
}

export function Tr({ children, className = '', ...rest }) {
  return (
    <tr
      className={`border-b border-ink-100 hover:bg-ink-50 transition-colors ${className}`}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className = '', align = 'left' }) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td
      className={`px-3 py-3 ${alignClass} text-[13px] text-ink-900 align-middle whitespace-nowrap ${className}`}
    >
      {children}
    </td>
  );
}

export function Dash() {
  return <span className="text-ink-300">—</span>;
}

/**
 * Small icon-only button for table row actions.
 * Hairline border, ink hover bg. Pass an icon as children.
 */
export function IconButton({ children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-ink-100 bg-transparent transition-colors hover:bg-ink-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Soft-filled data pill — used for counts/status inside table cells.
 * Trackwork style: rounded-full, subtle colored fill.
 *
 * Tones:
 *   neutral  — grey
 *   success  — green filled (for completion %, positive states)
 *   warn     — amber
 *   danger   — red
 *   accent   — violet (for count badges like sessions/clients)
 *   accentOutline — violet outlined (for secondary counts)
 */
export function Pill({ children, tone = 'neutral', size = 'sm' }) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700',
    success: 'bg-success-weak text-success',
    warn: 'bg-warn-weak text-warn',
    danger: 'bg-danger-weak text-danger',
    accent: 'bg-accent-weak text-accent',
    accentOutline: 'border border-accent/20 text-accent bg-transparent',
  };
  const sizes = {
    sm: 'px-2 py-[2px] text-[11px]',
    md: 'px-2.5 py-[3px] text-[12px]',
  };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-medium ${sizes[size]} ${tones[tone] ?? tones.neutral}`}
    >
      {children}
    </span>
  );
}
