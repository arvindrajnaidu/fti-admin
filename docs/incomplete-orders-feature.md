# Incomplete/Abandoned Orders Feature - Requirements

## Questions to Answer

### 1. Data Structure
**Where are incomplete/abandoned orders stored in Firestore?**

- [ ] Same "orders" collection with specific status values?
  - If yes, what are the status values? (e.g., "pending", "payment_failed", "abandoned", "cart")
- [ ] Separate collection (e.g., "carts", "incomplete_orders")?
  - If yes, what's the collection name?
- [ ] Other structure?

**Your Answer:**
```
[Write your answer here]
```

---

### 2. UI Approach
**How would you like to access this incomplete orders view?**

Options:
- [ ] Separate tabs at the top (e.g., "Orders" | "Incomplete Orders")
- [ ] Filter/toggle on the same page (e.g., "Show All" / "Show Incomplete")
- [ ] Completely separate page/route
- [ ] Other approach

**Your Answer:**
```
[Write your answer here]
```

---

### 3. Display Information
**What information should be displayed for incomplete orders?**

Suggested columns (check all that apply):
- [ ] Order ID
- [ ] Date/Time created
- [ ] Sender Name
- [ ] Sender Email
- [ ] Recipient Name
- [ ] Recipient Phone
- [ ] Recipient City
- [ ] Restaurant Name
- [ ] Total Amount
- [ ] Status (pending/failed/abandoned)
- [ ] Abandoned timestamp
- [ ] Payment failure reason
- [ ] Time since last activity
- [ ] Other: _______________

**Your Answer:**
```
[Write your answer here]
```

---

### 4. Available Actions
**What actions should be available for each incomplete order?**

Options (check all that apply):
- [ ] View order details (modal)
- [ ] Send recovery email with coupon
- [ ] Copy recovery/checkout link
- [ ] Mark as "contacted"
- [ ] Delete/archive incomplete order
- [ ] Manually complete the order
- [ ] View cart contents
- [ ] Download CSV of incomplete orders
- [ ] Other: _______________

**Your Answer:**
```
[Write your answer here]
```

---

### 5. Filtering & Search
**Should incomplete orders be searchable/filterable?**

- [ ] Search by sender email/name
- [ ] Filter by status (pending/failed/abandoned)
- [ ] Filter by date range
- [ ] Filter by amount range
- [ ] Sort by date (oldest/newest first)
- [ ] Other filters: _______________

**Your Answer:**
```
[Write your answer here]
```

---

### 6. Recovery/Follow-up Features
**What recovery actions need to be implemented?**

- [ ] Email integration (what service? SendGrid, Mailgun, Firebase Email, etc.)
- [ ] Coupon code generation (manual or automatic?)
- [ ] Custom recovery link generation (what should the link do?)
- [ ] Tracking who was contacted and when
- [ ] Other: _______________

**Your Answer:**
```
[Write your answer here]
```

---

## Additional Notes
Any other requirements or considerations:

```
[Write additional notes here]
```
