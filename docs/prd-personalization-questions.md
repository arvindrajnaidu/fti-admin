# PRD: Personalization Questions on Order Success Page

**Status:** Draft
**Created:** January 2026
**Priority:** Medium

---

## Overview

Add optional questions on the order success page to capture data about who customers are sending food to and why. This data will provide business insights into customer behavior and enable future personalization features.

## Problem Statement

We currently have no visibility into:
- Who our customers are sending food to (parents, friends, spouse, etc.)
- Why they're sending food (birthdays, festivals, just because, etc.)

This data would help us:
1. Understand customer segments and use cases
2. Tailor marketing campaigns (e.g., birthday reminders)
3. Enable future personalized messaging to recipients

## Proposed Solution

### Questions to Add (Optional)

**Question 1: "Who is this food for?"**
| Option | Value |
|--------|-------|
| Friends | `friends` |
| Parents | `parents` |
| Spouse/Partner | `spouse` |
| Other Family | `family` |

**Question 2: "What's the occasion?"**
| Option | Value |
|--------|-------|
| Birthday | `birthday` |
| Festival/Celebration | `festival` |
| Anniversary | `anniversary` |
| Just Thinking of You | `thinking` |

### User Experience

- Questions appear on success page after order confirmation
- Chip-based selection (tap to select, tap again to deselect)
- User can select one option per question
- "Skip" option to dismiss without answering
- "Done" button to submit selections
- Thank you message shown after submission

### UI Mockup

```
┌─────────────────────────────────────────────────┐
│  ✓ Order Placed Successfully!                   │
│  ... existing success content ...               │
│                                                 │
│  ─────────────────────────────────────────────  │
│                                                 │
│  Help us personalize! (Optional)                │
│                                                 │
│  Who is this food for?                          │
│  [Friends] [Parents] [Spouse/Partner] [Family]  │
│                                                 │
│  What's the occasion?                           │
│  [Birthday] [Festival] [Anniversary] [Thinking] │
│                                                 │
│            [Skip]     [Done]                    │
│                                                 │
│  ─────────────────────────────────────────────  │
│                                                 │
│  [Create Another Order]                         │
└─────────────────────────────────────────────────┘
```

## Technical Implementation

### Data Model

Add to order document in Firestore (`users/{uid}/orders/{orderId}`):

```javascript
{
  // ... existing order fields ...

  personalization: {
    recipient: "parents" | "friends" | "spouse" | "family" | null,
    occasion: "birthday" | "festival" | "anniversary" | "thinking" | null,
    submittedAt: <timestamp>
  }
}
```

### Files to Modify

1. **`/pages/orders/success/OrderSuccess.js`** - Add personalization UI
2. **`/pages/api/orders/[orderId]/personalize.js`** (NEW) - API endpoint to save data

### API Endpoint

**POST** `/api/orders/{orderId}/personalize`

Request:
```json
{
  "recipient": "parents",
  "occasion": "birthday"
}
```

Response:
```json
{
  "success": true
}
```

## Success Metrics

- **Completion rate**: % of users who answer vs skip
- **Data distribution**: Breakdown by recipient type and occasion
- **Insights generated**: Actionable learnings from the data

## Future Enhancements

1. **Personalized SMS to recipients** - Use occasion data to send customized messages like "Happy Birthday! [Sender] is sending you food from [Restaurant]"
2. **Occasion reminders** - Remind users of upcoming birthdays/anniversaries
3. **Marketing segmentation** - Target campaigns based on customer segments

## Open Questions

1. Should we add more recipient options? (e.g., Colleague, In-laws)
2. Should we add more occasion options? (e.g., Get Well Soon, Congratulations)
3. Should we track if user skipped vs never saw the questions?

---

## Appendix: Analytics Queries

Once implemented, we can analyze:

```sql
-- Distribution by recipient type
SELECT personalization.recipient, COUNT(*)
FROM orders
WHERE personalization IS NOT NULL
GROUP BY personalization.recipient

-- Distribution by occasion
SELECT personalization.occasion, COUNT(*)
FROM orders
WHERE personalization IS NOT NULL
GROUP BY personalization.occasion

-- Most common combinations
SELECT personalization.recipient, personalization.occasion, COUNT(*)
FROM orders
WHERE personalization IS NOT NULL
GROUP BY personalization.recipient, personalization.occasion
ORDER BY COUNT(*) DESC
```
