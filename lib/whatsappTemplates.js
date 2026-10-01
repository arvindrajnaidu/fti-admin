// WhatsApp recipient-confirmation message templates.
//
// Six variants driven by three booleans (per spec §1):
//   A  hasFullAddress  — door/flat + street are set on the order
//   B  hasTime         — sender chose a scheduled delivery time
//   C  hasProfile      — recipient has a confirmed address profile on file
//
// Phase 1 always passes `hasProfile = false` because we haven't enabled
// the `recipients/{phoneE164}` profile lookup on incoming orders yet.
//
// Pure function; no I/O, no scheduling.js dependency, no DOM. Safe to
// import in either app's API route or a script.
//
// MIRRORED FROM foodtoindia/lib/whatsappTemplates.js — keep both in sync.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const MEAL_WINDOW_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

function formatTimeIst(epochMs) {
  if (epochMs == null) return null;
  const ist = new Date(epochMs + IST_OFFSET_MS);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatTimeWithMealWindow(epochMs, mealWindow) {
  const timeIst = formatTimeIst(epochMs);
  const label = MEAL_WINDOW_LABELS[mealWindow];
  if (!timeIst || !label) return timeIst;
  return `${label} (${timeIst} IST)`;
}

function pickVariant({ hasProfile, hasFullAddress, hasTime }) {
  if (hasProfile && hasTime) return 1;
  if (hasProfile) return 2;
  if (hasFullAddress && hasTime) return 3;
  if (hasFullAddress) return 4;
  if (hasTime) return 5;
  return 6;
}

// Body builders. Each takes the variables it needs and returns the full
// message string (newlines included). The caller picks the variant.
const BODIES = {
  1: ({ recipientName, senderFirstName, restaurantName, profileAddress, timeIst, confirmationUrl }) =>
`Hi ${recipientName}, this is from FoodToIndia. ${senderFirstName} has sent you a food order from ${restaurantName}.

We have your address as:
${profileAddress}

Your order will be delivered around ${timeIst}. Please let us know if this doesn't work for you.

Or confirm here: ${confirmationUrl}`,

  2: ({ recipientName, senderFirstName, restaurantName, profileAddress, confirmationUrl }) =>
`Hi ${recipientName}, this is from FoodToIndia. ${senderFirstName} has sent you a food order from ${restaurantName}.

We have your address as:
${profileAddress}

What time would work best for delivery?

Or confirm here: ${confirmationUrl}`,

  3: ({ recipientName, senderFirstName, restaurantName, fullAddress, timeIst, confirmationUrl }) =>
`Hi ${recipientName}, this is from FoodToIndia. ${senderFirstName} has sent you a food order from ${restaurantName}.

We have your address as:
${fullAddress}

Your order will be delivered around ${timeIst}. Please let us know if this doesn't work for you.

Is the address correct? If not, please reply with the correct address.

Or confirm here: ${confirmationUrl}`,

  4: ({ recipientName, senderFirstName, restaurantName, fullAddress, confirmationUrl }) =>
`Hi ${recipientName}, this is from FoodToIndia. ${senderFirstName} has sent you a food order from ${restaurantName}.

We have your address as:
${fullAddress}

What time would work best for delivery?

Or confirm here: ${confirmationUrl}`,

  5: ({ recipientName, senderFirstName, restaurantName, areaCity, timeIst, confirmationUrl }) =>
`Hi ${recipientName}, this is from FoodToIndia. ${senderFirstName} has sent you a food order from ${restaurantName}.

We have your location as ${areaCity}. Could you please share your full address including building/flat number and landmark?

Your order is scheduled to be delivered around ${timeIst}. Please let us know if this doesn't work for you.

Or confirm here: ${confirmationUrl}`,

  6: ({ recipientName, senderFirstName, restaurantName, areaCity, confirmationUrl }) =>
`Hi ${recipientName}, this is from FoodToIndia. ${senderFirstName} has sent you a food order from ${restaurantName}.

We have your location as ${areaCity}. Could you please share your full address including building/flat number and landmark?

What time would work best for delivery?

Or confirm here: ${confirmationUrl}`,
};

// buildMessage — the entry point.
//
//   recipientName, senderFirstName, restaurantName: strings
//   scheduledForMs: epoch ms of delivery time, or null
//   mealWindow: optional meal-window id for scheduled delivery
//   fullAddress: human-readable joined address with door/flat+street, or null
//   areaCity: "Area, City" string (used only when fullAddress is null), or null
//   profileAddress: confirmed-from-profile address string, or null (Phase 2)
//   confirmationUrl: the /confirm/[orderId]?token=... URL
//
// Returns: the full message text. Throws if required vars for the picked
// variant are missing (programmer error, not a user-data shape).
function buildMessage(args) {
  const {
    recipientName,
    senderFirstName,
    restaurantName,
    scheduledForMs,
    mealWindow,
    fullAddress,
    areaCity,
    profileAddress,
    confirmationUrl,
  } = args;

  const hasProfile = !!profileAddress;
  const hasFullAddress = !!fullAddress;
  const hasTime = scheduledForMs != null;
  const variant = pickVariant({ hasProfile, hasFullAddress, hasTime });
  const bareTimeIst = formatTimeIst(scheduledForMs);
  const mealWindowTimeIst = MEAL_WINDOW_LABELS[mealWindow]
    ? formatTimeWithMealWindow(scheduledForMs, mealWindow)
    : null;
  const timeIst = mealWindowTimeIst || (bareTimeIst ? `${bareTimeIst} IST` : null);

  return BODIES[variant]({
    recipientName,
    senderFirstName,
    restaurantName,
    profileAddress,
    fullAddress,
    areaCity,
    timeIst,
    confirmationUrl,
  });
}

// Build a wa.me deep link. Phone is `recipient.recipientPhoneE164` like
// "+919094264478"; strip the leading "+" for wa.me.
function buildWaMeUrl(phoneE164, messageText) {
  if (!phoneE164) return null;
  const phone = phoneE164.startsWith('+') ? phoneE164.slice(1) : phoneE164;
  return `https://wa.me/${phone}?text=${encodeURIComponent(messageText)}`;
}

module.exports = {
  buildMessage,
  buildWaMeUrl,
  pickVariant,
  formatTimeIst,
  formatTimeWithMealWindow,
};
