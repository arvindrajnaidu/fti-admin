// Shared traveler (self_visiting) address formatter. MIRRORED verbatim in the
// admin repo (admin/lib/travelerAddressFormat.js) so the Slack [NEW ORDER]
// message and the admin Order Details view render the SAME grouped block.
//
// Grouped format (traveler orders only):
//   <venue label>            e.g. "Hotel / Hostel"
//   <venue name>             recipient.addressLine, e.g. "Grand Hyatt Mumbai Hotel & Residences"
//   <full address>           the raw Places address the customer saw, e.g. "Bandra Kurla Complex, ..., India"
//   <room label>: <doorNo>   e.g. "Room #: 1201"  (label varies by venue)
//   Landmark: <landmark>     omitted when empty
//
// Slack is constrained by the fixed order-bot Cloud Function template, so the
// caller maps these onto the CF fields (Address / Door No / Landmark). The
// admin has no such constraint and renders the lines directly.

const VENUE_LABEL = {
  hotel: 'Hotel',
  apartment: 'Apartment / Hostel',
  office: 'Office',
  other: 'Other',
};

const ROOM_LABEL = {
  hotel: 'Room #',
  apartment: 'Flat / Door #',
  office: 'Floor / desk / room',
  other: 'Door / Flat / Room #',
};

function travelerVenueLabel(venueType) {
  return VENUE_LABEL[venueType] || 'Stay';
}

function travelerRoomLabel(venueType) {
  return ROOM_LABEL[venueType] || 'Door / Flat / Room #';
}

// The room line, e.g. "Room #: 1201". Empty string when no door value.
function travelerRoomLine(venueType, doorNo) {
  const d = String(doorNo || '').trim();
  if (!d) return '';
  return `${travelerRoomLabel(venueType)}: ${d}`;
}

// The address block lines 1-3 (venue label, venue name, full address). Used as
// the Slack "Address:" value AND the top of the admin block. Skips empties.
function travelerAddressBlockLines({ venueType, addressLine, fullAddress }) {
  return [
    travelerVenueLabel(venueType),
    String(addressLine || '').trim(),
    String(fullAddress || '').trim(),
  ].filter(Boolean);
}

// The full 5-line block the admin renders. `doorNo` is the RAW room value
// (e.g. "1201"), NOT a pre-labeled string.
function travelerAddressLines({ venueType, addressLine, fullAddress, doorNo, landmark }) {
  const lines = travelerAddressBlockLines({ venueType, addressLine, fullAddress });
  const room = travelerRoomLine(venueType, doorNo);
  if (room) lines.push(room);
  const lm = String(landmark || '').trim();
  if (lm) lines.push(`Landmark: ${lm}`);
  return lines;
}

module.exports = {
  VENUE_LABEL,
  ROOM_LABEL,
  travelerVenueLabel,
  travelerRoomLabel,
  travelerRoomLine,
  travelerAddressBlockLines,
  travelerAddressLines,
};
