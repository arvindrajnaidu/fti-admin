# Stripe IP Address & Location Capture - Requirements

## Overview
Capture and store IP address and location data from Stripe payment confirmations to help with fraud detection, analytics, and customer insights.

---

## Implementation Location
**Main Application** (not admin panel)
- Implement during payment confirmation flow
- Store data in Firestore order document when payment succeeds

---

## Questions to Answer

### 1. Stripe Integration Details
**What Stripe data is currently available during payment?**

Current payment flow location:
- [ ] File path: _______________
- [ ] Function name: _______________

Stripe payment ID field name in order document:
- [ ] `paymentIntentId`
- [ ] `chargeId`
- [ ] `stripePaymentId`
- [ ] Other: _______________

**Your Answer:**
```
[Write your answer here - include the file path where payment confirmation happens]
```

---

### 2. Data to Capture from Stripe
**What information should we capture?**

From Stripe PaymentIntent or Charge object:
- [ ] IP Address (`charges.data[0].billing_details.address` or `charges.data[0].receipt_email`)
- [ ] Country (from `charges.data[0].billing_details.address.country`)
- [ ] Postal Code (from `charges.data[0].billing_details.address.postal_code`)
- [ ] Risk Score (from `charges.data[0].outcome.risk_score`)
- [ ] Risk Level (from `charges.data[0].outcome.risk_level`)
- [ ] Card Country (from `charges.data[0].payment_method_details.card.country`)
- [ ] Other: _______________

**Your Answer:**
```
[Write your answer here]
```

---

### 3. Database Schema
**Where and how should this data be stored?**

Storage location in order document:
- [ ] Top-level fields (e.g., `senderIpAddress`, `senderCountry`)
- [ ] Nested object (e.g., `paymentDetails.ipAddress`, `paymentDetails.country`)
- [ ] Separate collection linked by order ID
- [ ] Other: _______________

Suggested fields to add to order document:
```
{
  // Existing order fields...

  paymentDetails: {
    ipAddress: "203.0.113.42",
    country: "US",
    postalCode: "94102",
    cardCountry: "US",
    riskScore: 45,
    riskLevel: "normal"
  }
}
```

**Your Answer:**
```
[Confirm the structure or provide your preferred schema]
```

---

### 4. Stripe API Keys
**Provide Stripe credentials for implementation**

Environment:
- [ ] Production (live keys)
- [ ] Test mode (test keys)

Keys needed (add to environment variables):
- Publishable Key: `pk_live_...` or `pk_test_...`
- Secret Key: `sk_live_...` or `sk_test_...`

**Your Answer:**
```
[Add keys here, or specify where they should be stored]
```

---

### 5. Error Handling
**How should we handle failures?**

If Stripe IP data is not available:
- [ ] Continue with order creation (soft fail)
- [ ] Log error but don't block payment
- [ ] Store `null` values for missing data
- [ ] Other: _______________

**Your Answer:**
```
[Write your answer here]
```

---

### 6. Privacy & Compliance
**Any privacy considerations?**

- [ ] GDPR compliance - need to document IP storage in privacy policy?
- [ ] Data retention - should we delete IP data after X days?
- [ ] User consent - do we inform users about IP logging?
- [ ] Anonymization - should we hash/anonymize IPs?

**Your Answer:**
```
[Write your answer here]
```

---

### 7. Display in Admin (Future)
**How should this data be displayed in admin panel?**

- [ ] Show in order details modal
- [ ] Add column to main orders table
- [ ] Show in sender analytics modal
- [ ] Create separate fraud detection view
- [ ] All of the above
- [ ] Other: _______________

**Your Answer:**
```
[Write your answer here]
```

---

## Implementation Checklist
Once requirements are defined:

- [ ] Add Stripe secret key to environment variables
- [ ] Update payment confirmation function to fetch Stripe charge/payment intent details
- [ ] Extract IP address and location data from Stripe response
- [ ] Update Firestore order document schema
- [ ] Store IP/location data in order document
- [ ] Add error handling for missing data
- [ ] Test with test payments
- [ ] Update privacy policy if needed
- [ ] Deploy to production

---

## Additional Notes
Any other requirements or considerations:

```
[Write additional notes here]
```

---

## Related Files to Modify
List the main project files that need changes:

1. Payment confirmation function: _______________
2. Order creation function: _______________
3. Environment config: _______________
4. Other: _______________
