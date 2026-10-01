import { X } from '@phosphor-icons/react';

/**
 * Trackwork-styled modal overlay + panel with a close button.
 * Click outside to close; Esc via onClose handler.
 *
 * Props:
 *   open      — boolean
 *   onClose   — () => void
 *   title     — optional heading text
 *   subtitle  — optional descriptor under the title
 *   maxWidth  — Tailwind arbitrary value for panel width, e.g. "max-w-[640px]"
 *   children  — modal body
 */
export function Modal({ open, onClose, title, subtitle, maxWidth = 'max-w-[720px]', children }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 md:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={`relative w-full ${maxWidth} max-h-[90vh] overflow-auto rounded-[8px] border border-ink-100 bg-ink-0 shadow-[0_20px_40px_rgba(11,14,20,0.12)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
        >
          <X className="h-4 w-4" weight="regular" />
        </button>
        {title || subtitle ? (
          <div className="border-b border-ink-100 px-6 py-4">
            {title ? (
              <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 text-[12px] text-ink-500">{subtitle}</p>
            ) : null}
          </div>
        ) : null}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
