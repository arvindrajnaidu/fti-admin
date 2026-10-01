// Sanity check for the WhatsApp message template builder.
// Prints all 6 variants so we can eyeball before any UI work.
// Run: node admin/scripts/_test-whatsapp.js

const { buildMessage, buildWaMeUrl, pickVariant } = require('../lib/whatsappTemplates');

const base = {
  recipientName: 'Priya',
  senderFirstName: 'Arvind',
  restaurantName: 'Mavalli Tiffin Rooms',
  confirmationUrl: 'https://foodtoindia.com/confirm/abc123?token=xyz',
};

const TIME = new Date('2026-05-19T08:00:00Z').getTime(); // 1:30 PM IST
const FULL = 'Flat 402, Sunshine Apartments\nMG Road, near Forum Mall\nKoramangala, Bengaluru';
const AREA = 'Koramangala, Bengaluru';
const PROFILE = 'Flat 402, Sunshine Apts, MG Rd, Bengaluru';

const cases = [
  { name: '1 · profile + time',         args: { ...base, scheduledForMs: TIME,  profileAddress: PROFILE, fullAddress: null, areaCity: null } },
  { name: '2 · profile + no time',      args: { ...base, scheduledForMs: null,  profileAddress: PROFILE, fullAddress: null, areaCity: null } },
  { name: '3 · full address + time',    args: { ...base, scheduledForMs: TIME,  profileAddress: null,    fullAddress: FULL, areaCity: null } },
  { name: '4 · full address + no time', args: { ...base, scheduledForMs: null,  profileAddress: null,    fullAddress: FULL, areaCity: null } },
  { name: '5 · area only + time',       args: { ...base, scheduledForMs: TIME,  profileAddress: null,    fullAddress: null, areaCity: AREA } },
  { name: '6 · area only + no time',    args: { ...base, scheduledForMs: null,  profileAddress: null,    fullAddress: null, areaCity: AREA } },
];

for (const c of cases) {
  const variant = pickVariant({
    hasProfile: !!c.args.profileAddress,
    hasFullAddress: !!c.args.fullAddress,
    hasTime: c.args.scheduledForMs != null,
  });
  console.log('\n=== Variant', c.name, '(pickVariant →', variant, ') ===');
  console.log(buildMessage(c.args));
}

console.log('\n=== wa.me URL ===');
console.log(buildWaMeUrl('+919094264478', 'Hi! Test message with spaces & symbols.'));
