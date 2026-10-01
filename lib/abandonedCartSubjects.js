import { toTitleCase } from './titleCase';

/**
 * Abandoned-cart email subject line templates.
 *
 * Exposed to the admin dropdown (manual sends) and — once the cron is
 * flipped on — to the cron job, which should import and pick per-cart
 * (or run a simple A/B split on the key). Storing the chosen `key` on
 * the temp-order doc (as `reminderSentSubjectKey`) lets us correlate
 * opens / conversions back to the subject variant.
 *
 * Each template is passed `{ recipient, restaurant }`. Pass the
 * already-resolved recipient (use `resolveRecipientName` below to get
 * the title-cased full name, or null when there's no specific recipient).
 * Templates render a "you/your" generic variant when recipient is null.
 */

/**
 * Title-cased full recipient name, OR null when no specific recipient
 * applies — i.e. cart has no recipient, the field is "N/A", or sender
 * is ordering for themselves. Use the result everywhere subject + body
 * mention the recipient so the preview and the actual send agree.
 */
export function resolveRecipientName({ raw, senderName }) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^n\/?a$/i.test(trimmed)) return null;
  const titled = toTitleCase(trimmed);
  if (senderName && titled.toLowerCase() === String(senderName).trim().toLowerCase()) return null;
  return titled;
}

const hasRecipient = (recipient) => Boolean(recipient && String(recipient).trim());

export const ABANDONED_CART_SUBJECTS = [
  {
    key: 'waiting',
    template: 'A cart for {name} is still waiting',
    render: ({ recipient }) => {
      if (!hasRecipient(recipient)) return 'A cart you created is still waiting';
      return `A cart for ${recipient} is still waiting`;
    },
  },
  {
    key: 'almost-done',
    template: "{name}'s order is almost done",
    render: ({ recipient }) => {
      if (!hasRecipient(recipient)) return 'Your order is almost done';
      return `${recipient}'s order is almost done`;
    },
  },
  {
    key: 'almost-there',
    template: 'Your order for {name} is almost there',
    render: ({ recipient }) => {
      if (!hasRecipient(recipient)) return 'Your order is almost there';
      return `Your order for ${recipient} is almost there`;
    },
  },
];

export const DEFAULT_SUBJECT_KEY = 'waiting';

export function renderSubject(key, { recipient, restaurant } = {}) {
  const tpl =
    ABANDONED_CART_SUBJECTS.find((t) => t.key === key) ||
    ABANDONED_CART_SUBJECTS.find((t) => t.key === DEFAULT_SUBJECT_KEY);
  return tpl.render({ recipient, restaurant });
}
