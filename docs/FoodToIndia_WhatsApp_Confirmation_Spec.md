# WhatsApp Recipient Confirmation + Confirmation Page — Full Spec

## Context

Our ops person currently calls or WhatsApps recipients manually to confirm delivery address and timing before placing orders on Swiggy/Zomato. This is untracked — no record of when contact was attempted, what was confirmed, or what time the recipient requested. If the ops person forgets a detail from a WhatsApp conversation, orders get delayed or fail.

We need three things:

1. A "Send WhatsApp" button on each order in the dispatch queue that opens WhatsApp with a smart pre-formatted message
2. A public recipient confirmation page (no auth) where recipients can confirm their address and pick a delivery time via a link included in the WhatsApp message
3. Dispatch queue enhancements: "Deliver at" field, ops address editing, and "Ready to dispatch" logic for repeat recipients

---

## Part 1: WhatsApp Button on Dispatch Queue

### Location

The dispatch queue page (the existing Overdue / ASAP / Scheduled sections). Add a WhatsApp icon button on each order row, next to the recipient info.

### On click

1. Generate a random 32-character token and store it as `recipientContact.confirmToken` on the order document in Firestore
2. Generate the confirmation page URL: `https://foodtoindia.com/confirm/[orderId]?token=[confirmToken]`
3. Build the pre-formatted message based on the message logic below
4. Open a WhatsApp deep link: `https://wa.me/[phone]?text=[encoded message]`
   - Phone number from `recipient.recipientPhoneE164` — strip any spaces, use country code without the `+`
5. Log the contact attempt on the order document:

```
recipientContact: {
  whatsappSentAt: timestamp,
  confirmToken: string (random 32 chars),
  confirmationPageUrl: string,
  status: 'pending'
}
```

6. Show a visual indicator on the order row: "WA sent" label with timestamp

### Message logic

The message content depends on what data exists on the order. Check three conditions:

- **(A)** Does the order have a full address? Check if door/flat number AND street/address line fields have values — not just the area/locality used for restaurant matching. If those detail fields are empty or missing, treat it as area-only.
- **(B)** Does the order have a sender-selected delivery time?
- **(C)** Does the recipient have a confirmed address on file from a previous order? (See Part 4 for recipient profile lookup)

#### If confirmed address on file + delivery time exists:

```
Hi [Recipient Name], this is from FoodToIndia. [Sender First Name] has sent you a food order from [Restaurant].

We have your address as:
[Full Address from profile]

Your order will be delivered around [Time] IST. Please let us know if this doesn't work for you.

Or confirm here: [confirmation page link]
```

#### If confirmed address on file + no delivery time:

```
Hi [Recipient Name], this is from FoodToIndia. [Sender First Name] has sent you a food order from [Restaurant].

We have your address as:
[Full Address from profile]

What time would work best for delivery?

Or confirm here: [confirmation page link]
```

#### If full address on order (no profile) + delivery time exists:

```
Hi [Recipient Name], this is from FoodToIndia. [Sender First Name] has sent you a food order from [Restaurant].

We have your address as:
[Full Address including door/flat, street, landmark, area, city]

Your order will be delivered around [Time] IST. Please let us know if this doesn't work for you.

Is the address correct? If not, please reply with the correct address.

Or confirm here: [confirmation page link]
```

#### If full address on order (no profile) + no delivery time:

```
Hi [Recipient Name], this is from FoodToIndia. [Sender First Name] has sent you a food order from [Restaurant].

We have your address as:
[Full Address including door/flat, street, landmark, area, city]

What time would work best for delivery?

Or confirm here: [confirmation page link]
```

#### If only area/city + delivery time exists:

```
Hi [Recipient Name], this is from FoodToIndia. [Sender First Name] has sent you a food order from [Restaurant].

We have your location as [Area, City]. Could you please share your full address including building/flat number and landmark?

Your order is scheduled to be delivered around [Time] IST. Please let us know if this doesn't work for you.

Or confirm here: [confirmation page link]
```

#### If only area/city + no delivery time:

```
Hi [Recipient Name], this is from FoodToIndia. [Sender First Name] has sent you a food order from [Restaurant].

We have your location as [Area, City]. Could you please share your full address including building/flat number and landmark?

What time would work best for delivery?

Or confirm here: [confirmation page link]
```

### Variable sources

- `[Recipient Name]` — from `recipient.recipientName` on the order
- `[Sender First Name]` — first name from sender profile or order sender name
- `[Restaurant]` — restaurant name from the order
- `[Full Address]` — concatenate door/flat, street, landmark, area, city from recipient address fields
- `[Area, City]` — from the area/locality and city fields
- `[Time]` — from the scheduled delivery time on the order, formatted in IST
- `[confirmation page link]` — the generated URL with order ID and token

---

## Part 2: Recipient Confirmation Page

### Route

`/confirm/[orderId]` in the `foodtoindia/` app. Public page — no authentication required.

### Security

The URL includes a query parameter: `/confirm/[orderId]?token=[confirmToken]`. The page calls a Next.js API route (`/api/confirm-order`) that validates both the order ID and token before reading or writing any data. Do not give the public page direct Firestore read/write access.

- If token doesn't match or is missing: show "This link is invalid or has expired."
- If order is already delivered or cancelled: show "This order has already been processed."
- If recipient already confirmed: show "You've already confirmed this delivery. If you need to make changes, please reply to our WhatsApp message." Do not allow re-submission.

### Page content

**Header:** FoodToIndia logo

**Main section:**
- "[Sender First Name] is sending you food from [Restaurant]"
- If cart items are available, show a summary: "[Item 1], [Item 2], [Item 3]..." (just names, no prices)

**Address section:**
- If full address exists on order or profile: show it pre-filled with an "Edit" button that expands the fields for editing
- If only area/city: show empty fields that need to be filled

Fields (all editable):
- Area / Locality (pre-filled from order, read-only if it determines restaurant availability)
- Door / Flat No. (text input)
- Street / Address Line (text input)
- Landmark (text input, helper text: "Helps the delivery driver find you")

**Delivery time section:**
- If sender chose a specific time: show "Your order is scheduled for delivery around [Time] IST" with two buttons: "This works" / "I need a different time"
  - If "I need a different time" is clicked: show time slot picker
- If no time was set by sender: show time slot picker directly
  - Time slots in 1-hour windows in IST (e.g. "11:00 AM - 12:00 PM", "12:00 PM - 1:00 PM", etc.)
  - Only show slots that are at least 2 hours from now (to allow ops time to place the order)
  - Also show an option: "As soon as possible"

**Submit button:** "Confirm Delivery"

### On submit

Call `/api/confirm-order` with the order ID, token, and form data. The API route validates the token, then updates Firestore:

1. Update the order document:
   - `recipientContact.status` = `'confirmed'`
   - `recipientContact.confirmedAt` = timestamp
   - `recipientContact.confirmedAddress` = full address object from the form
   - `recipientContact.confirmedTimeSlot` = selected time slot or "ASAP"
   - If recipient changed the sender's preferred time: `recipientContact.timeChanged` = true

2. Update the recipient profile (see Part 4):
   - `recipients/[phoneE164].confirmedAddress` = full address object
   - `recipients/[phoneE164].addressSource` = `'recipient_confirmed'`
   - `recipients/[phoneE164].addressUpdatedAt` = timestamp
   - `recipients/[phoneE164].name` = recipient name
   - `recipients/[phoneE164].lastOrderId` = this order ID

3. If recipient changed the delivery time (`timeChanged` is true): send an automated email to the sender via Resend:
   - Subject: "Delivery time updated for [Recipient Name]"
   - Body: "[Recipient Name] has updated the delivery time to [New Time] IST. We'll deliver at the updated time."
   - Use the existing FoodToIndia branded email template
   - No action required from sender, just informational

4. Show confirmation screen: "Thank you! Your delivery details have been confirmed. [Sender First Name] is sending you something special."

### Mobile-friendly

This page will almost always be opened on a phone from a WhatsApp link. Large tap targets, simple layout, no unnecessary scrolling. Test on mobile viewport.

---

## Part 3: Dispatch Queue Enhancements

### "Deliver at" field

Add an editable "Deliver at" date/time field on each order in the dispatch queue.

**Auto-population logic:**
- If sender selected a time at checkout: pre-populate with that time
- If recipient confirmed a time via the confirmation page: update to the recipient's confirmed time (overrides sender's time)
- If ops person manually enters a time (from WhatsApp conversation): that value is used

**Sorting:**
- Within each section (Overdue / ASAP / Scheduled), sort orders by "Deliver at" time ascending — next order to go out is always at the top
- Orders with no "Deliver at" time sort after timed orders

**Visual indicators:**
- Orders approaching their delivery window (within 30 minutes): yellow background
- Orders past their delivery window: red / overdue styling (matching existing overdue design)

### Ops address editing

Add an editable address section accessible from each order in the dispatch queue:
- Ops person can click to view and edit the recipient address (door/flat, street, landmark, area, city)
- On save, update BOTH:
  - The current order's delivery address
  - The recipient profile in `recipients/[phoneE164]` — set `addressSource` = `'ops_updated'` and `addressUpdatedAt` = now
- Show a small "Address updated" confirmation after save

### Status indicators on order rows

Each order row in the dispatch queue should show a status badge:

- **"Ready"** (green) — confirmed address on file + sender selected delivery time. Can be dispatched without contacting recipient.
- **"Confirmed"** (green) — recipient confirmed via confirmation page. Address and time are set.
- **"WA sent"** (yellow) — WhatsApp was sent, waiting for recipient response. Show timestamp.
- **"Pending"** (grey) — no contact attempt yet.
- **"No response"** (red) — WhatsApp sent but no response after 4+ hours.

---

## Part 4: Recipient Profile & Repeat Customer Logic

### Recipient profile collection

Maintain a Firestore collection `recipients/[phoneE164]` keyed by the recipient's phone number in E164 format:

```
{
  name: string,
  confirmedAddress: {
    doorFlat: string,
    street: string,
    landmark: string,
    area: string,
    city: string,
    state: string,
    pincode: string
  },
  addressSource: 'recipient_confirmed' | 'ops_updated',
  addressUpdatedAt: timestamp,
  lastOrderId: string
}
```

### When to update the recipient profile

- **Recipient confirms via confirmation page** → update profile, set `addressSource` = `'recipient_confirmed'`
- **Ops person edits address in dispatch queue** → update profile, set `addressSource` = `'ops_updated'`
- **Last write wins** regardless of source. If ops corrected the address on order #1, that carries to order #2. If the recipient later confirms a different address via the confirmation page on order #3, that overwrites the ops edit.

### When a new order comes in

Look up the recipient phone number (E164 format) in the `recipients` collection.

**If a confirmed address exists on the profile:**
- Pre-fill the full address on the new order from the profile
- Show a "Confirmed address on file" badge in the dispatch queue row
- If sender also selected a delivery time → mark order as **"Ready to dispatch"** (no recipient contact needed, no WhatsApp necessary)
- If no delivery time selected → still needs time confirmation only. WhatsApp message skips address and just asks about timing.

**If no confirmed address exists:**
- Use whatever address the sender provided (full or area-only)
- Follow the standard WhatsApp message templates from Part 1

### Edge case: sender entered a different area/city than what's on file

If the recipient has a confirmed address on file but the sender entered a different area or city on the new order, do NOT auto-fill from profile. The recipient may have moved or the sender is sending to a different location. Treat as a new address and follow the standard flow.

---

## Summary of Firestore changes

### New fields on order document (`users/{uid}/orders/{id}`):

```
recipientContact: {
  whatsappSentAt: timestamp | null,
  confirmToken: string | null,
  confirmationPageUrl: string | null,
  status: 'pending' | 'confirmed' | 'no_response',
  confirmedAt: timestamp | null,
  confirmedAddress: { doorFlat, street, landmark, area, city, state, pincode } | null,
  confirmedTimeSlot: string | null,
  timeChanged: boolean
}
```

### New collection: `recipients/{phoneE164}`

```
{
  name: string,
  confirmedAddress: { doorFlat, street, landmark, area, city, state, pincode },
  addressSource: 'recipient_confirmed' | 'ops_updated',
  addressUpdatedAt: timestamp,
  lastOrderId: string
}
```

---

## What this does NOT include (intentionally)

- **WhatsApp Business API / Twilio integration** — we're using manual WhatsApp via deep links for now. Graduate to API when volume exceeds 100 orders/week.
- **Automated WhatsApp sending** — ops person clicks the button manually. No cron-based auto-sending.
- **AI/LLM for parsing WhatsApp replies** — ops person reads WhatsApp replies and updates the dashboard manually. The confirmation page handles the structured data capture.
- **Reminder system for ops** — the "Deliver at" sorting and visual indicators (yellow/red) in the dispatch queue serve as the reminder mechanism. No separate notification system needed yet.
