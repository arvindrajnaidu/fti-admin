/*
 * Verification test page — verbatim port of DESIGN_TOKENS.md Section 6.
 *
 * Route: /design-test (no auth) — open in the browser after applying tokens.
 * If this renders a monochrome grayscale ramp, status pills in calm colors,
 * an accent purple pill, and aligned-digit numbers in IBM Plex Sans —
 * tokens are in.
 */
export default function TokenTest() {
  return (
    <main className="min-h-screen bg-ink-0 p-8 space-y-6 font-sans">
      <h1 className="text-[22px] font-semibold text-ink-900 tracking-tight">Design token test</h1>
      <p className="text-[13px] text-ink-500">Body text should render in IBM Plex Sans.</p>
      <div className="flex gap-2">
        {[0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => (
          <div key={n} className={`w-10 h-10 rounded border border-ink-100 bg-ink-${n}`} />
        ))}
      </div>
      <div className="flex gap-3">
        <span className="px-2 py-0.5 rounded-[4px] bg-success-weak text-success text-[12px]">success</span>
        <span className="px-2 py-0.5 rounded-[4px] bg-warn-weak text-warn text-[12px]">warn</span>
        <span className="px-2 py-0.5 rounded-[4px] bg-danger-weak text-danger text-[12px]">danger</span>
        <span className="px-2 py-0.5 rounded-[4px] bg-accent-weak text-accent text-[12px]">accent</span>
      </div>
      <div className="tnum text-[13px] text-ink-900">1,234.56 should be tabular</div>
      <div className="text-[10px] uppercase tracking-micro text-ink-500">micro label</div>
    </main>
  );
}
