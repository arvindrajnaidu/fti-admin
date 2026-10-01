const FLAG_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);

export function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '';
  const up = cc.toUpperCase();
  return String.fromCodePoint(up.charCodeAt(0) + FLAG_OFFSET, up.charCodeAt(1) + FLAG_OFFSET);
}

export function formatRecipientPhone(recipient) {
  if (!recipient) return '';
  const e164 = recipient.recipientPhoneE164;
  const country = recipient.recipientPhoneCountry;
  const isWA = recipient.recipientPhoneIsWhatsApp;
  // recipientPhone is stored inconsistently: some records already include a
  // country code ("+91 98407 02569" / "+63 916 ...") while older ones are bare
  // ("9840702569"). Only prepend +91 when it isn't already an international
  // number, else we get a double prefix ("+91 +91 ...").
  const rp = recipient.recipientPhone ? String(recipient.recipientPhone).trim() : '';
  const phoneText = e164
    || recipient.phone
    || (rp ? (rp.startsWith('+') ? rp : `+91 ${rp}`) : '');
  if (!phoneText) return '';
  const flag = country && country !== 'IN' ? `${flagEmoji(country)} ` : '';
  const waChip = isWA === true ? '  (WA)'
    : (country && country !== 'IN' && isWA === false ? '  (no WA)' : '');
  return `${flag}${phoneText}${waChip}`;
}
