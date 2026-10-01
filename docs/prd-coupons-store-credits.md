# PRD: Promo Codes (MVP)

**Status:** Draft
**Priority:** High
**Scope:** MVP - Promo codes + existing referral credits

---

## Overview

Add promo codes to work alongside the existing referral credits system.

**Existing:** Referral credits (user earns by referring friends)
**New:** Promo codes (admin creates discount campaigns)

**Key Rule:** Only ONE discount per order - user chooses promo code OR referral credits

---

## What We're NOT Building (MVP)

- ~~Store credits~~ (deferred to v2)
- No per-user promo limits
- No first-order-only codes
- No email-restricted codes
- No analytics dashboards

---

## How It Works

**For Admin:**
1. Create promo code in admin panel (e.g., HOLI25 = 25% off)
2. Share code via marketing channels

**For Customer:**
1. At checkout, choose: use referral credits OR enter promo code
2. If promo code entered, validates and shows discount
3. Discount reflected in order total and confirmation email

---

## Data Model

```javascript
// promo-codes/{id}
{
  code: "HOLI25",              // Uppercase, unique
  type: "percent" | "fixed",   // 25% off or $25 off
  value: 25,                   // 25 (percent) or 2500 (cents for fixed)
  minOrderUSD: 2000 | null,    // Min $20 order, null = no minimum
  maxDiscountUSD: 1000 | null, // Cap at $10 (for percent), null = no cap
  expiresAt: timestamp | null, // null = never expires
  isActive: true,
  totalRedemptions: 0,
  createdAt: timestamp
}
```

### Examples

| Code | Type | Value | Min Order | Max Discount | Result |
|------|------|-------|-----------|--------------|--------|
| `HOLI25` | percent | 25 | $20 | $10 | 25% off, max $10 |
| `10OFF` | fixed | $10 | $25 | - | $10 off orders $25+ |
| `FLAT5` | fixed | $5 | - | - | $5 off any order |

---

## Validation Rules

Check in order:
1. Code exists (case-insensitive)
2. `isActive === true`
3. Not expired
4. Order meets minimum (if set)

Error messages:
- "Promo code not found"
- "This code has expired"
- "Minimum order of $20 required"

---

## Admin UI

Single page `/admin/pages/promo-codes.js`:

**List View:**
- Table: Code, Type, Value, Min Order, Expires, Redemptions, Status
- Toggle to enable/disable each code

**Create Form:**
- Code (auto-uppercase)
- Type: Percentage / Fixed
- Value
- Min order (optional)
- Max discount (optional, for %)
- Expiry date (optional)

---

## Checkout Integration

### Current State (Referral Credits)

Today in `MutableOrderTable.js`:
- Toggle switch: "Use Referral Credits ($X available)"
- Max $10 per order
- Min order requirement from campaign

### New UI: Discount Selector

Replace toggle with a choice between referral credits and promo code:

**User has referral credits:**
```
┌─────────────────────────────────────────┐
│ Apply Discount (choose one)             │
│                                         │
│ ○ Use Referral Credits ($5.00 available)│
│   Max $10.00 per order                  │
│                                         │
│ ○ Use Promo Code                        │
│   [HOLI25_______] [Apply]               │
│                                         │
│ ○ No discount                           │
│                                         │
│ Discount applied: -$5.00                │
└─────────────────────────────────────────┘
```

**User has NO referral credits:**
```
┌─────────────────────────────────────────┐
│ Have a promo code?                      │
│ [HOLI25_______] [Apply]                 │
│                                         │
│ ✓ 25% off applied (-$5.00)              │
└─────────────────────────────────────────┘
```

### Behavior

1. **Default:** No discount selected
2. **Referral credits option:** Only shown if user has balance > $0
3. **Promo code:** Always shown
4. **Radio buttons:** Enforce single selection (no stacking)
5. **Promo validation:** On "Apply" click, call API, show result
6. **Total updates:** Immediately when discount selected/validated

### Error States

- Invalid promo: Show error below input, keep promo option selected
- Expired promo: "This code has expired"
- Min order: "Minimum order of $20 required for this code"

---

## Technical Implementation

### New Files

**Main App:**
| File | Purpose |
|------|---------|
| `/lib/promo.js` | Validate promo code, calculate discount |
| `/pages/api/promo/validate.js` | POST: validate code |

**Admin App:**
| File | Purpose |
|------|---------|
| `/pages/promo-codes.js` | Promo codes admin page |
| `/pages/api/promo-codes.js` | CRUD for promo codes |

### Modified Files

| File | Change |
|------|--------|
| `/components/MutableOrderTable.js` | Replace referral toggle with discount selector (referral OR promo) |
| `/components/OrderContext.js` | Add `discountType` ("referral" \| "promo" \| null), `promoCode`, `promoDiscountUSD` |
| `/pages/api/orders.js` | Handle promo discount (similar to existing referral credit logic) |
| `/lib/notifications.js` | Show promo discount in email (similar to referral credits display) |

### API

**POST `/api/promo/validate`**
```javascript
// Request
{ code: "HOLI25", orderTotalUSD: 2500 }

// Success
{ valid: true, discountUSD: 625, description: "25% off" }

// Error
{ valid: false, error: "Code expired" }
```

---

## Order Storage

**Existing field (keep as-is):**
```javascript
// For referral credits
referralCreditsApplied: {
  amountUSD: 500,
  originalTotalUSD: 2500,
  finalTotalUSD: 2000
} | null
```

**New field (add for promo codes):**
```javascript
// For promo codes
promoApplied: {
  code: "HOLI25",
  discountUSD: 625,
  type: "percent",
  value: 25
} | null
```

**Rule:** An order has either `referralCreditsApplied` OR `promoApplied`, never both.

---

## Implementation Plan

### Phase 1: Backend (1 day)
- [ ] Create `promo-codes` collection
- [ ] Build `/lib/promo.js` (validate, calculate)
- [ ] Build `/api/promo/validate.js`

### Phase 2: Admin UI (1 day)
- [ ] Promo codes page (list, create, toggle)
- [ ] Admin API endpoints

### Phase 3: Checkout (1-2 days)
- [ ] Add promo input to MutableOrderTable
- [ ] Update OrderContext
- [ ] Update order creation API
- [ ] Update confirmation email

### Phase 4: Test (0.5 day)
- [ ] Create code, apply at checkout, verify order
- [ ] Test expired code, min order error

**Total: ~3-4 days**

---

## Future Enhancements (v2)

- Store credits system
- Per-user promo limits
- First-order-only codes
- Usage caps per code
