# Product Requirements Document: Customer Retention Campaigns

**Version:** 1.0
**Created:** January 13, 2026
**Owner:** Product Team
**Status:** Draft

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Goals & Success Metrics](#goals--success-metrics)
4. [User Personas](#user-personas)
5. [Features & Requirements](#features--requirements)
6. [Technical Architecture](#technical-architecture)
7. [Implementation Phases](#implementation-phases)
8. [Email Templates](#email-templates)
9. [Analytics & Tracking](#analytics--tracking)
10. [Budget & Resources](#budget--resources)

---

## Executive Summary

**Objective:** Increase repeat purchase rate from 50.4% to 65% within 3 months by implementing automated retention campaigns targeting first-time buyers.

**Current State:**
- 1,937 total orders from 337 customers
- 49.6% (167 customers) are one-time buyers
- Average 5.75 orders per customer
- $9.97 average order value

**Proposed Solution:**
Implement a multi-phase retention system using:
- Automated email sequences
- Birthday/festival reminders
- Gamification (care streaks)
- Referral program
- Segment-based targeting

**Budget:** ~$10-15/month (SendGrid + Firebase)

---

## Problem Statement

### Current Challenges
1. **High One-Time Customer Rate:** 49.6% of customers never place a second order
2. **Lost Revenue:** Each lost customer represents ~$57 in lifetime value (based on repeat customer average)
3. **No Post-Purchase Engagement:** No automated follow-up after first order
4. **Missed Opportunities:** No reminders for birthdays, festivals, or regular care sending

### Customer Pain Points
- "I forgot to send food to my mom this week"
- "I don't know when to order again"
- "Reordering is too much effort"
- "I forgot about the service after my first order"

### Business Impact
- **Annual Lost Revenue:** 167 one-time customers × $57 LTV = **~$9,519 in missed revenue**
- **Customer Acquisition Cost Waste:** Marketing spend wasted on customers who don't return

---

## Goals & Success Metrics

### Primary Goals
1. **Increase repeat purchase rate** from 50.4% → 65% (3 months)
2. **Reduce time to 2nd order** from 30 days → 14 days
3. **Increase average orders per customer** from 5.75 → 7.0

### Secondary Goals
4. Increase email engagement (35% open rate, 8% CTR)
5. Generate 50+ referrals in first 3 months
6. Achieve 15% of customers on care streak (weekly ordering)

### Success Metrics

| Metric | Current | Target (3mo) | Measurement |
|--------|---------|--------------|-------------|
| Repeat Purchase Rate | 50.4% | 65% | % customers with 2+ orders |
| Days to 2nd Order | ~30 days | 14 days | Avg time between order 1 & 2 |
| Orders/Customer | 5.75 | 7.0 | Total orders / unique customers |
| Email Open Rate | - | 35% | Opened / Delivered |
| Email CTR | - | 8% | Clicks / Delivered |
| Monthly Active Users | - | 80 | Customers ordering in month |
| Referral Sign-ups | 0 | 50 | New customers via referral |

---

## User Personas

### Persona 1: "Loving Child" (Primary - 60% of customers)
**Profile:**
- Age: 25-40
- Location: USA, Canada, UK, Middle East
- Sends to: Parents in India
- Frequency: Weekly to monthly
- AOV: $8-12

**Example:** Raghav Vadehra (342 orders to father in Jalandhar)

**Motivations:**
- Show care for aging parents
- Ensure parents eat well
- Convenience (ordering is easier than asking neighbor)

**Pain Points:**
- Forgets to order regularly
- Guilt when skipping weeks
- Wants peace of mind parents are fed

**Messaging:**
- "Keep mom healthy with weekly meals"
- "Never miss a week of showing you care"
- "Your care streak: 4 weeks! 🔥"

---

### Persona 2: "Multi-City Gifter" (15% of customers)
**Profile:**
- Age: 30-50
- Location: Global
- Sends to: Multiple family/friends across India
- Frequency: Occasional (festivals, birthdays)
- AOV: $10-15

**Example:** Arvind Naidu (88 orders to 9 cities)

**Motivations:**
- Stay connected with extended family
- Celebrate occasions remotely
- Send gifts easily

**Pain Points:**
- Managing multiple recipients
- Remembering all birthdays
- Bulk ordering friction

**Messaging:**
- "Send to all 5 recipients at once"
- "Buy $50 credit, get $60 to share"
- "Birthday reminder: Aunt Rita's birthday in 5 days"

---

### Persona 3: "Long-Distance Partner" (10% of customers)
**Profile:**
- Age: 20-35
- Location: Different city/country than partner
- Sends to: Boyfriend/girlfriend/spouse
- Frequency: Weekly (date nights, surprises)
- AOV: $12-18

**Motivations:**
- Maintain intimacy despite distance
- Surprise partner
- Virtual date nights

**Pain Points:**
- Making it feel special, not transactional
- Timing (want it to arrive at right moment)
- Variety (don't want same restaurant every time)

**Messaging:**
- "Surprise them with Friday date night dinner"
- "Send romantic dinner for two"
- "They'll call to thank you 😊"

---

### Persona 4: "One-Time Triers" (15% of customers)
**Profile:**
- Age: 25-60
- Location: Various
- Sends to: Various recipients
- Frequency: Once (never returned)
- AOV: $8-12

**Current State:** 167 customers (49.6%)

**Motivations (for first order):**
- Emergency (parent sick, needed food fast)
- One-time occasion (birthday, festival)
- Tried service out of curiosity

**Why They Don't Return:**
- ❌ Forgot about service
- ❌ Didn't know when to order again
- ❌ Thought it was one-time need only
- ❌ Friction in reordering
- ❌ No reminder or incentive

**Conversion Strategy:**
- **Day 1 Email:** Positive reinforcement + discount
- **Day 7 Email:** Gentle nudge with urgency ($3 off expires soon)
- **Day 30 Email:** Bigger incentive ($5) + social proof
- **Quick Reorder:** One-click reorder same meal

---

## Features & Requirements

### Phase 1: Quick Wins (Week 1-2)

#### Feature 1.1: Post-Order Email Sequence
**Description:** Automated 3-email sequence after first order

**User Story:**
> As a first-time customer, I want to receive follow-up emails with incentives so that I remember to order again.

**Requirements:**

**Email 1: Day 1 After Delivery**
- **Trigger:** Order status = "dispatched" + 1 day
- **Subject:** "Did [Recipient Name] enjoy their meal? 🍽️"
- **Content:**
  - Personal greeting with customer & recipient names
  - Feedback request (3 emoji buttons)
  - $2 discount code: `CAREFAM2`
  - CTA: "Send Again" button (pre-filled cart with same order)
- **Technical:**
  - Firebase Cloud Function triggered on order status change
  - SendGrid template with dynamic variables
  - Store feedback in Firestore: `users/{uid}/feedback/{orderId}`

**Email 2: Day 7 (if no 2nd order)**
- **Trigger:** 7 days after first order AND orderCount === 1
- **Subject:** "Missing [Recipient Name]? Send them a treat 🎁"
- **Content:**
  - Remind about recipient
  - $3 discount code: `COMEBACK3` (expires in 3 days)
  - Show popular restaurants in recipient's city
  - CTAs: "Reorder Same Meal" + "Browse Restaurants"
- **Technical:**
  - Scheduled Cloud Function runs daily
  - Check users with `firstOrderDate === 7 days ago`
  - Only send if `orderCount === 1`

**Email 3: Day 30 (if no 2nd order)**
- **Trigger:** 30 days after first order AND orderCount === 1
- **Subject:** "They're probably hungry by now... 😊"
- **Content:**
  - Gentle humor
  - $5 discount code: `MONTH5` (expires in 7 days)
  - Social proof: "Our customers send food 5-6 times on average"
  - Last chance messaging
- **Technical:**
  - Scheduled Cloud Function runs daily
  - Check users with `firstOrderDate === 30 days ago`
  - Mark user as "churned" if still no 2nd order after 60 days

**Acceptance Criteria:**
- [ ] Emails sent automatically at correct intervals
- [ ] Discount codes work and are unique per customer
- [ ] "Send Again" button pre-fills cart with exact same order
- [ ] Emails do not send if customer already placed 2nd order
- [ ] Unsubscribe link included in footer
- [ ] Email open/click rates tracked in analytics

**Technical Specs:**
```javascript
// Firestore Structure
users/{uid}/emailCampaigns {
  day1Sent: timestamp | null,
  day7Sent: timestamp | null,
  day30Sent: timestamp | null,
  day1Opened: boolean,
  day7Opened: boolean,
  day30Opened: boolean,
  day1Clicked: boolean,
  day7Clicked: boolean,
  day30Clicked: boolean
}

// Cloud Function Triggers
1. onOrderStatusChange → Send Day 1 Email
2. scheduledDaily(09:00 IST) → Check for Day 7 & Day 30 sends
```

---

#### Feature 1.2: "Send Again" Quick Action
**Description:** One-click reorder from email and dashboard

**User Story:**
> As a customer, I want to quickly reorder the same meal without re-entering everything.

**Requirements:**

**Email Implementation:**
- Add "Send Again" CTA button in all order confirmation emails
- Button links to: `https://foodtoindia.com/reorder?orderId={orderId}`
- Pre-fills cart with:
  - Same recipient
  - Same restaurant
  - Same items & quantities
  - User just clicks "Checkout"

**Dashboard Implementation:**
- Add "Reorder" button next to each past order in `/orders` page
- Shows tooltip: "Send same order to [Recipient Name]"
- Clicking opens cart with pre-filled items

**Acceptance Criteria:**
- [ ] Email "Send Again" button works for all past orders
- [ ] Cart pre-fills correctly with exact same items
- [ ] Works even if menu items are no longer available (show warning)
- [ ] Apply any active discount codes automatically
- [ ] Track reorder conversion rate

**Technical Specs:**
```javascript
// API Endpoint: /api/reorder
POST /api/reorder
{
  orderId: "ABC123"
}

Response:
{
  cartItems: [...],
  recipient: {...},
  restaurant: {...},
  availabilityWarnings: [...]  // if items unavailable
}

// Frontend: Auto-populate CartContext
```

---

#### Feature 1.3: Recipient Birthday Collection
**Description:** Collect recipient birthdays during checkout

**User Story:**
> As a customer, I want to be reminded of my recipient's birthday so I can send them a special meal.

**Requirements:**

**Checkout Flow Addition:**
- After recipient selection, show optional field:
  ```
  📅 When is [Recipient Name]'s birthday?

  [MM] / [DD]

  We'll remind you to send them a treat! 🎂
  [Skip]
  ```
- Store in Firestore: `users/{uid}/recipients/{recipientId}/birthday`

**Recipient Management Page:**
- Show "Add Birthday" button for recipients without birthday
- Edit birthday for existing recipients
- Show upcoming birthdays in dashboard

**Acceptance Criteria:**
- [ ] Birthday field optional during checkout
- [ ] Accepts MM/DD format (no year needed)
- [ ] Validates input (01-12 for month, 01-31 for day)
- [ ] Stored securely in Firestore
- [ ] Can edit/delete birthday later
- [ ] Dashboard shows "Upcoming Birthdays" widget

**Technical Specs:**
```javascript
// Firestore Structure
users/{uid}/recipients/{recipientId} {
  name: string,
  phone: string,
  location: {...},
  birthday: {
    month: number,  // 1-12
    day: number     // 1-31
  } | null,
  birthdayReminderSent: timestamp | null
}
```

---

### Phase 2: Retention Mechanics (Week 3-4)

#### Feature 2.1: Birthday Reminder System
**Description:** Automated email 7 days before recipient's birthday

**User Story:**
> As a customer, I want to be reminded of my recipient's birthday so I don't forget to send them a cake.

**Requirements:**

**Email Trigger:**
- Runs daily at 9 AM IST
- Checks all recipients with birthdays in 7 days
- Sends email to customer

**Email Content:**
- **Subject:** "🎂 [Recipient Name]'s birthday is in 7 days!"
- **Body:**
  - Birthday reminder
  - Suggested items: cakes, sweets, special meals
  - Discount code: `BDAY10` (10% off birthday orders)
  - Popular birthday restaurants in recipient's city
  - CTAs: "Order Birthday Cake" + "Browse Sweets"

**Follow-up Email (if not ordered):**
- **Day Before Birthday:** Final reminder
- **Subject:** "🎉 Tomorrow is [Recipient Name]'s birthday!"
- Urgency messaging + same-day delivery note

**Acceptance Criteria:**
- [ ] Emails sent exactly 7 days before birthday
- [ ] Follow-up sent 1 day before if no order placed
- [ ] Shows relevant birthday items (cakes, sweets)
- [ ] Filters restaurants in recipient's city
- [ ] Stops sending if customer already ordered
- [ ] Marks birthday as "reminded" to prevent duplicates

**Technical Specs:**
```javascript
// Cloud Function: scheduledBirthdayReminder
// Runs daily at 09:00 IST

exports.scheduledBirthdayReminder = functions.pubsub
  .schedule('0 9 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    const today = new Date();
    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(today.getDate() + 7);

    const targetMonth = sevenDaysLater.getMonth() + 1;
    const targetDay = sevenDaysLater.getDate();

    // Query all recipients with matching birthday
    const recipientsSnapshot = await db.collectionGroup('recipients')
      .where('birthday.month', '==', targetMonth)
      .where('birthday.day', '==', targetDay)
      .get();

    // Send emails to customers
    for (const recipientDoc of recipientsSnapshot.docs) {
      const recipient = recipientDoc.data();
      const userId = recipientDoc.ref.parent.parent.id;

      // Check if already sent this year
      const lastReminder = recipient.birthdayReminderSent;
      if (lastReminder && isThisYear(lastReminder)) {
        continue; // Already reminded this year
      }

      // Get customer email
      const userDoc = await db.collection('users').doc(userId).get();
      const customerEmail = userDoc.data().email;

      // Send email
      await sendBirthdayReminderEmail(customerEmail, recipient);

      // Mark as sent
      await recipientDoc.ref.update({
        birthdayReminderSent: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });
```

---

#### Feature 2.2: Festival Campaign System
**Description:** Targeted emails before major Indian festivals

**User Story:**
> As a customer, I want to be reminded of festivals so I can send traditional food to my family.

**Requirements:**

**Festival Calendar:**
- Diwali (Oct/Nov)
- Holi (Mar)
- Raksha Bandhan (Aug)
- Dussehra (Oct)
- Pongal (Jan) - South India
- Onam (Aug/Sep) - Kerala
- Eid (varies) - Muslim customers
- Christmas (Dec) - Christian customers

**Email Campaign (7 days before festival):**
- **Subject:** "Send [Festival Name] sweets to everyone you love 🪔"
- **Content:**
  - Festival greeting
  - Special offer: "Order 3+ items → 20% off"
  - Popular festival items (sweets, special meals)
  - Multi-recipient option
  - CTAs: "Browse Sweets" + "Send to Multiple People"

**Technical Implementation:**
- Manual campaign creation (initially)
- Future: Automated based on calendar
- Segment by recipient location (regional festivals)

**Acceptance Criteria:**
- [ ] Email sent 7 days before each major festival
- [ ] Segmented by recipient location (regional festivals)
- [ ] Shows relevant festival items (sweets, special meals)
- [ ] Discount codes work for multiple items
- [ ] Track conversion rate by festival

**Festival Schedule (2026):**
```
Jan 14: Pongal (South India)
Jan 26: Republic Day
Mar 14: Holi
Mar 30: Eid ul-Fitr (approx)
Apr 06: Ugadi (Andhra/Karnataka)
Apr 14: Baisakhi (Punjab)
May 11: Mother's Day
Jun 15: Father's Day
Aug 15: Independence Day
Aug 27: Raksha Bandhan
Sep 05: Onam (Kerala)
Oct 02: Gandhi Jayanti
Oct 12: Dussehra
Oct 20: Diwali
Dec 25: Christmas
```

---

#### Feature 2.3: Abandoned Cart Recovery
**Description:** Email sent if customer adds items but doesn't checkout

**User Story:**
> As a customer who got distracted during checkout, I want to be reminded to complete my order.

**Requirements:**

**Trigger:**
- Customer adds items to cart
- Leaves site without completing order
- Cart saved for 24 hours

**Email Sequence:**

**Email 1: 15 minutes after abandonment**
- **Subject:** "Forget something? Cart saved for [Recipient Name]"
- **Content:**
  - Show cart items
  - $1 discount code: `CART5`
  - Direct link to checkout
  - CTA: "Complete Order Now"

**Email 2: 24 hours later (if still not ordered)**
- **Subject:** "Your cart expires soon - $2 off inside"
- **Content:**
  - Cart items listed
  - $2 discount code: `CART2DAY`
  - Urgency: "Cart expires in 24 hours"
  - CTA: "Complete Order"

**Acceptance Criteria:**
- [ ] Cart items saved when customer leaves
- [ ] Email 1 sent 15 minutes after abandonment
- [ ] Email 2 sent 24 hours later if not completed
- [ ] No emails sent if order completed
- [ ] Cart link takes directly to checkout page
- [ ] Track cart recovery rate

**Technical Specs:**
```javascript
// Track cart abandonment
// When user adds to cart, create abandoned cart record

// Firestore Structure
abandonedCarts/{cartId} {
  userId: string,
  items: array,
  recipient: object,
  restaurant: object,
  createdAt: timestamp,
  email15minSent: boolean,
  email24hrSent: boolean,
  recovered: boolean,
  recoveredAt: timestamp | null
}

// Cloud Functions
1. scheduledEvery15Min() → Check for 15min-old carts, send email
2. scheduledDaily() → Check for 24hr-old carts, send email
3. onOrderCreate() → Mark cart as recovered if matches
```

---

### Phase 3: Gamification (Month 2)

#### Feature 3.1: Care Streak System
**Description:** Track consecutive weeks customer sends food, reward streaks

**User Story:**
> As a regular customer, I want to be rewarded for consistently sending food to my loved ones.

**Requirements:**

**Streak Tracking:**
- Count consecutive weeks with at least 1 order
- Reset if customer misses a full week (7 days)
- Show current streak in dashboard
- Send weekly reminder if streak at risk

**Rewards:**
- Week 4: $3 credit
- Week 8: Free dessert
- Week 12: $10 credit
- Week 26: $25 credit + VIP status
- Week 52: $50 credit + "Year of Care" badge

**Dashboard Widget:**
```
🔥 Your Care Streak: 5 weeks!

Progress to next reward:
[████████░░] Week 8 - Free Dessert

Last order: 3 days ago
Send this week to keep your streak! →
```

**Weekly Reminder Email (if no order this week):**
- **Day 5 of week (Friday):** "Don't break your 5-week streak! 🔥"
- **Day 6 of week (Saturday):** "Last day to keep your streak!"

**Acceptance Criteria:**
- [ ] Streak increments correctly each week
- [ ] Resets if week missed
- [ ] Credits automatically applied at milestones
- [ ] Dashboard shows streak prominently
- [ ] Reminder emails sent Friday if no order yet
- [ ] Track streak engagement rate

**Technical Specs:**
```javascript
// Firestore Structure
users/{uid}/careStreak {
  currentStreak: number,        // Weeks
  longestStreak: number,        // All-time best
  lastOrderDate: timestamp,
  streakStartDate: timestamp,
  weeklyReminderSent: boolean,
  rewards: {
    week4: { earned: boolean, appliedAt: timestamp },
    week8: { earned: boolean, appliedAt: timestamp },
    week12: { earned: boolean, appliedAt: timestamp },
    week26: { earned: boolean, appliedAt: timestamp },
    week52: { earned: boolean, appliedAt: timestamp }
  }
}

// Cloud Function: updateCareStreak
// Runs on every order creation
exports.onOrderCreate = functions.firestore
  .document('users/{userId}/orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data();
    const userId = context.params.userId;

    // Get user's care streak
    const streakRef = db.collection('users').doc(userId).collection('careStreak');
    const streakDoc = await streakRef.doc('current').get();

    // Calculate streak
    const now = new Date();
    const lastOrder = streakDoc.data()?.lastOrderDate?.toDate();

    if (!lastOrder) {
      // First order, start streak
      await streakRef.doc('current').set({
        currentStreak: 1,
        longestStreak: 1,
        lastOrderDate: now,
        streakStartDate: now
      });
    } else {
      const daysSinceLastOrder = (now - lastOrder) / (1000 * 60 * 60 * 24);

      if (daysSinceLastOrder <= 7) {
        // Within same week, no change
      } else if (daysSinceLastOrder <= 14) {
        // Next week, increment streak
        const newStreak = streakDoc.data().currentStreak + 1;
        await streakRef.doc('current').update({
          currentStreak: newStreak,
          longestStreak: Math.max(newStreak, streakDoc.data().longestStreak),
          lastOrderDate: now
        });

        // Check for rewards
        await checkAndApplyStreakRewards(userId, newStreak);
      } else {
        // Missed a week, reset streak
        await streakRef.doc('current').update({
          currentStreak: 1,
          lastOrderDate: now,
          streakStartDate: now
        });
      }
    }
  });
```

---

#### Feature 3.2: Referral Program
**Description:** Customers can refer friends, both get $5 credit

**User Story:**
> As a happy customer, I want to refer my friends and get rewards.

**Requirements:**

**Referral Link Generation:**
- Each customer gets unique referral code
- Format: `foodtoindia.com/ref/RAGHAV123`
- Code = firstName + random3digits

**Dashboard Section:**
```
🎁 Refer a Friend, You Both Get $5

Your referral link: foodtoindia.com/ref/RAGHAV123
[Copy Link] [Share via Email] [Share via WhatsApp]

Your Referrals:
• Amit Singh - Signed up Jan 10 ✅ (+$5 earned)
• Priya Patel - Signed up Jan 12 ✅ (+$5 earned)
• [Pending] - Link clicked, not signed up yet

Total Earned: $10 in credits
```

**How It Works:**
1. Customer shares referral link
2. Friend clicks link, cookie/session saved
3. Friend signs up & places first order
4. Both get $5 credit automatically

**Referral Email Template:**
```
Subject: Give $5, Get $5 - Send food to India

Hi [Customer Name],

Love FoodtoIndia? Share it with friends!

Your unique link: [LINK]

When they place their first order:
✓ They get $5 off
✓ You get $5 credit

Share now: [Email] [WhatsApp] [Copy Link]
```

**Acceptance Criteria:**
- [ ] Unique referral code generated for each customer
- [ ] Referral link works (tracks referrer)
- [ ] Credits applied automatically after referee's 1st order
- [ ] Dashboard shows referral stats
- [ ] Email/WhatsApp share buttons work
- [ ] Track referral conversion rate

**Technical Specs:**
```javascript
// Firestore Structure
users/{uid}/referral {
  code: string,              // e.g., "RAGHAV123"
  link: string,              // Full URL
  totalReferred: number,
  totalEarned: number,       // In cents
  referrals: [
    {
      email: string,
      signupDate: timestamp,
      firstOrderDate: timestamp | null,
      creditEarned: number,
      creditApplied: boolean
    }
  ]
}

// When new user signs up via referral
users/{newUserId}/metadata {
  referredBy: userId,
  referralCode: string,
  referralCreditApplied: boolean
}

// Cloud Function: applyReferralCredits
exports.onFirstOrderByReferee = functions.firestore
  .document('users/{userId}/orders/{orderId}')
  .onCreate(async (snap, context) => {
    const userId = context.params.userId;
    const userDoc = await db.collection('users').doc(userId).get();
    const metadata = userDoc.data().metadata;

    // Check if user was referred
    if (metadata?.referredBy && !metadata.referralCreditApplied) {
      const referrerId = metadata.referredBy;

      // Give $5 credit to new user
      await db.collection('users').doc(userId).update({
        'credits.available': admin.firestore.FieldValue.increment(50000), // $5 in cents
        'metadata.referralCreditApplied': true
      });

      // Give $5 credit to referrer
      await db.collection('users').doc(referrerId).update({
        'credits.available': admin.firestore.FieldValue.increment(50000),
        'referral.totalEarned': admin.firestore.FieldValue.increment(50000)
      });

      // Send notification emails to both
      await sendReferralSuccessEmails(referrerId, userId);
    }
  });
```

---

### Phase 4: Segments & Targeting (Month 3+)

#### Feature 4.1: Customer Segmentation
**Description:** Automatically segment customers based on behavior

**Segments:**

**1. VIP Customers**
- Definition: 10+ orders AND $200+ spent
- Count: ~10 customers
- Messaging: Exclusive perks, early access, personal thank you
- Rewards: Free upgrades, priority support

**2. Loving Children**
- Definition: Send to same city 100% of time + 5+ orders
- Count: ~40 customers
- Messaging: "Keep mom healthy", "Weekly care packages"
- Offers: Subscription discounts, health-focused meals

**3. Multi-City Gifters**
- Definition: Send to 3+ different cities
- Count: ~15 customers
- Messaging: "Bulk credit deals", "Send to everyone at once"
- Offers: "Buy $50 credit, get $60"

**4. At-Risk Customers**
- Definition: 2+ orders but none in last 60 days
- Count: Variable
- Messaging: Win-back campaigns, "We miss you"
- Offers: $5 off comeback order

**5. One-Time Customers**
- Definition: 1 order, 30+ days ago
- Count: 167 customers
- Messaging: Retention campaigns (already covered in Phase 1)

**Technical Specs:**
```javascript
// Cloud Function: updateCustomerSegments
// Runs daily to recalculate segments

exports.scheduledSegmentUpdate = functions.pubsub
  .schedule('0 2 * * *')  // 2 AM daily
  .onRun(async (context) => {
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;

      // Get all orders
      const ordersSnapshot = await db.collection('users')
        .doc(userId)
        .collection('orders')
        .get();

      const orders = ordersSnapshot.docs.map(d => d.data());

      // Calculate metrics
      const orderCount = orders.length;
      const totalSpent = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const cities = new Set(orders.map(o => o.recipient?.location?.city).filter(Boolean));
      const lastOrderDate = Math.max(...orders.map(o => o.createdAt?.toDate?.() || 0));
      const daysSinceLastOrder = (Date.now() - lastOrderDate) / (1000 * 60 * 60 * 24);

      // Determine segment
      let segment = 'new';

      if (orderCount >= 10 && totalSpent >= 2000000) {  // $200 in cents
        segment = 'vip';
      } else if (orderCount >= 5 && cities.size === 1) {
        segment = 'loving_child';
      } else if (cities.size >= 3) {
        segment = 'multi_city_gifter';
      } else if (orderCount >= 2 && daysSinceLastOrder > 60) {
        segment = 'at_risk';
      } else if (orderCount === 1 && daysSinceLastOrder > 30) {
        segment = 'one_time';
      } else if (orderCount >= 2) {
        segment = 'active';
      }

      // Update user document
      await db.collection('users').doc(userId).update({
        'analytics.segment': segment,
        'analytics.orderCount': orderCount,
        'analytics.totalSpent': totalSpent,
        'analytics.cityCount': cities.size,
        'analytics.daysSinceLastOrder': daysSinceLastOrder,
        'analytics.lastUpdated': admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });

// Firestore Structure
users/{uid}/analytics {
  segment: string,  // 'vip' | 'loving_child' | 'multi_city_gifter' | 'at_risk' | 'one_time' | 'active' | 'new'
  orderCount: number,
  totalSpent: number,
  cityCount: number,
  daysSinceLastOrder: number,
  lastUpdated: timestamp
}
```

---

#### Feature 4.2: Segment-Specific Campaigns
**Description:** Targeted email campaigns for each segment

**Campaign Schedule:**

**VIP Customers (Monthly):**
- **Subject:** "Thank you for being a VIP customer 👑"
- **Content:**
  - Personal thank you from founder
  - Exclusive early access to new restaurants
  - Free upgrade on next order
  - Priority support contact
- **Goal:** Retention, increase LTV

**Loving Children (Weekly):**
- **Subject:** "It's time for your weekly care package 📦"
- **Content:**
  - Reminder to send this week
  - Show care streak
  - Healthy meal options for parents
  - Subscription offer
- **Goal:** Increase order frequency

**Multi-City Gifters (Before Festivals):**
- **Subject:** "Send Diwali sweets to all 5 recipients 🪔"
- **Content:**
  - Bulk ordering option
  - Credit bundle deal
  - Multi-recipient checkout
  - Festival discount
- **Goal:** Increase AOV

**At-Risk Customers (One-time):**
- **Subject:** "We miss you! Come back with $5 off 💔"
- **Content:**
  - "We noticed you haven't ordered in a while"
  - $5 comeback offer
  - Show new restaurants added
  - Personal touch from team
- **Goal:** Reactivation

**Technical Implementation:**
```javascript
// Send segment-specific campaign
async function sendSegmentCampaign(segment, campaignName) {
  // Get all users in segment
  const usersSnapshot = await db.collection('users')
    .where('analytics.segment', '==', segment)
    .get();

  for (const userDoc of usersSnapshot.docs) {
    const user = userDoc.data();

    // Check if already sent this campaign
    const campaignSent = user.campaigns?.[campaignName]?.sent;
    if (campaignSent) continue;

    // Send email
    await sendEmail({
      to: user.email,
      templateId: getTemplateId(segment, campaignName),
      dynamicData: {
        name: user.displayName,
        segment: segment,
        orderCount: user.analytics.orderCount,
        // ... other personalization
      }
    });

    // Mark as sent
    await db.collection('users').doc(userDoc.id).update({
      [`campaigns.${campaignName}.sent`]: true,
      [`campaigns.${campaignName}.sentAt`]: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}
```

---

## Technical Architecture

### System Overview

```
┌─────────────────┐
│   User Places   │
│   First Order   │
└────────┬────────┘
         │
         v
┌─────────────────────────────────────────┐
│  Firebase Cloud Functions (Triggers)    │
├─────────────────────────────────────────┤
│  1. onOrderCreate                       │
│     - Save order data                   │
│     - Update user metrics               │
│     - Trigger Day 1 email               │
│                                         │
│  2. scheduledDaily (9 AM IST)           │
│     - Check Day 7 emails               │
│     - Check Day 30 emails              │
│     - Check birthday reminders         │
│     - Update customer segments         │
│                                         │
│  3. scheduledEvery15Min                 │
│     - Check abandoned carts            │
│     - Send recovery emails             │
│                                         │
│  4. scheduledWeekly (Friday 9 AM)       │
│     - Check care streaks               │
│     - Send streak reminder emails      │
└─────────────┬───────────────────────────┘
              │
              v
┌─────────────────────────────────────────┐
│         SendGrid API                    │
│  - Send transactional emails            │
│  - Track opens/clicks                   │
│  - Dynamic templates                    │
└─────────────┬───────────────────────────┘
              │
              v
┌─────────────────────────────────────────┐
│  Firestore (Data Storage)               │
├─────────────────────────────────────────┤
│  users/{uid}/                           │
│    - emailCampaigns                     │
│    - careStreak                         │
│    - referral                           │
│    - analytics                          │
│    - orders/                            │
│    - recipients/                        │
│  abandonedCarts/                        │
└─────────────────────────────────────────┘
```

### Data Models

**User Document:**
```javascript
users/{uid} {
  email: string,
  displayName: string,
  createdAt: timestamp,

  // Email Campaigns
  emailCampaigns: {
    day1Sent: timestamp | null,
    day7Sent: timestamp | null,
    day30Sent: timestamp | null,
    day1Opened: boolean,
    day7Opened: boolean,
    day30Opened: boolean,
    unsubscribed: boolean
  },

  // Care Streak
  careStreak: {
    currentStreak: number,
    longestStreak: number,
    lastOrderDate: timestamp,
    streakStartDate: timestamp,
    rewards: {
      week4: { earned: boolean, appliedAt: timestamp },
      week8: { earned: boolean, appliedAt: timestamp },
      week12: { earned: boolean, appliedAt: timestamp }
    }
  },

  // Referral
  referral: {
    code: string,
    link: string,
    totalReferred: number,
    totalEarned: number,
    referrals: []
  },

  // Analytics
  analytics: {
    segment: string,
    orderCount: number,
    totalSpent: number,
    cityCount: number,
    daysSinceLastOrder: number,
    firstOrderDate: timestamp,
    lastOrderDate: timestamp
  },

  // Credits
  credits: {
    available: number,  // In cents
    pending: number,
    totalEarned: number
  }
}
```

**Recipient Document:**
```javascript
users/{uid}/recipients/{recipientId} {
  name: string,
  phone: string,
  location: {
    city: string,
    state: string,
    formattedAddress: string
  },
  birthday: {
    month: number,  // 1-12
    day: number     // 1-31
  } | null,
  birthdayReminderSent: timestamp | null,
  createdAt: timestamp
}
```

**Abandoned Cart Document:**
```javascript
abandonedCarts/{cartId} {
  userId: string,
  items: [{
    itemId: string,
    name: string,
    quantity: number,
    price: number
  }],
  recipient: {...},
  restaurant: {...},
  totalAmount: number,
  createdAt: timestamp,
  expiresAt: timestamp,
  email15minSent: boolean,
  email24hrSent: boolean,
  recovered: boolean,
  recoveredOrderId: string | null
}
```

### Email Service Integration

**SendGrid Setup:**

1. **Create SendGrid Account:** Free tier (100 emails/day)
2. **API Key:** Store in Firebase environment config
3. **Dynamic Templates:** Create in SendGrid dashboard
4. **Webhook:** Track opens/clicks

**Template IDs:**
```javascript
const SENDGRID_TEMPLATES = {
  DAY_1_FOLLOWUP: 'd-abc123...',
  DAY_7_COMEBACK: 'd-def456...',
  DAY_30_WINBACK: 'd-ghi789...',
  BIRTHDAY_REMINDER: 'd-jkl012...',
  FESTIVAL_CAMPAIGN: 'd-mno345...',
  ABANDONED_CART_15MIN: 'd-pqr678...',
  ABANDONED_CART_24HR: 'd-stu901...',
  CARE_STREAK_REMINDER: 'd-vwx234...',
  REFERRAL_INVITE: 'd-yza567...'
};
```

**Send Email Function:**
```javascript
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(functions.config().sendgrid.key);

async function sendEmail(to, templateId, dynamicData) {
  const msg = {
    to: to,
    from: 'care@foodtoindia.com',
    templateId: templateId,
    dynamicTemplateData: {
      ...dynamicData,
      unsubscribeUrl: `https://foodtoindia.com/unsubscribe?email=${to}`
    },
    trackingSettings: {
      clickTracking: { enable: true },
      openTracking: { enable: true }
    }
  };

  try {
    await sgMail.send(msg);
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}
```

### Firebase Cloud Functions

**Function Structure:**
```
functions/
├── index.js                 # Main exports
├── triggers/
│   ├── onOrderCreate.js     # Triggered on new order
│   ├── onUserCreate.js      # Triggered on new user signup
│   └── onCartAbandoned.js   # Triggered when cart saved
├── scheduled/
│   ├── dailyEmailCheck.js   # Runs daily at 9 AM
│   ├── weeklyStreakCheck.js # Runs Fridays at 9 AM
│   ├── birthdayReminders.js # Runs daily at 9 AM
│   └── segmentUpdate.js     # Runs daily at 2 AM
├── email/
│   ├── sendEmail.js         # SendGrid integration
│   └── templates.js         # Email template helpers
└── utils/
    ├── dateUtils.js
    ├── segmentCalculator.js
    └── streakCalculator.js
```

**Deploy Commands:**
```bash
# Install dependencies
cd functions
npm install @sendgrid/mail firebase-admin firebase-functions

# Deploy all functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:scheduledDailyEmailCheck
```

---

## Email Templates

### Template 1: Day 1 Follow-Up

**SendGrid Template ID:** `d-day1-followup`

**Subject:** Did {{recipientName}} enjoy their meal? 🍽️

**HTML Body:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 8px; }
    .button { display: inline-block; padding: 12px 30px; background: #ff6b35; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
    .code { background: #fff3cd; padding: 10px 20px; font-size: 18px; font-weight: bold; border-radius: 5px; display: inline-block; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🍽️ Food Delivered!</h1>
    </div>

    <div class="content">
      <p>Hi {{customerName}},</p>

      <p>We hope <strong>{{recipientName}}</strong> enjoyed their <strong>{{restaurantName}}</strong> order!</p>

      <p>Quick question: How did it go?</p>

      <div style="text-align: center; margin: 20px 0;">
        <a href="{{feedbackUrl}}?rating=great" style="font-size: 30px; text-decoration: none; margin: 0 10px;">😊</a>
        <a href="{{feedbackUrl}}?rating=ok" style="font-size: 30px; text-decoration: none; margin: 0 10px;">😐</a>
        <a href="{{feedbackUrl}}?rating=poor" style="font-size: 30px; text-decoration: none; margin: 0 10px;">😞</a>
      </div>

      <hr style="margin: 30px 0;">

      <p><strong>Sending food again soon?</strong></p>
      <p>Use this code for $2 off your next order:</p>

      <div style="text-align: center;">
        <div class="code">CAREFAM2</div>
      </div>

      <div style="text-align: center; margin-top: 20px;">
        <a href="{{reorderUrl}}" class="button">Send Same Order Again →</a>
      </div>
    </div>

    <div class="footer">
      <p>- The FoodToIndia Team</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a> | <a href="https://foodtoindia.com">Visit Website</a></p>
    </div>
  </div>
</body>
</html>
```

**Dynamic Variables:**
- `{{customerName}}` - Customer's first name
- `{{recipientName}}` - Recipient's first name
- `{{restaurantName}}` - Restaurant name
- `{{feedbackUrl}}` - Link to feedback page
- `{{reorderUrl}}` - Link to reorder same meal
- `{{unsubscribeUrl}}` - Unsubscribe link

---

### Template 2: Day 7 Come Back

**SendGrid Template ID:** `d-day7-comeback`

**Subject:** Missing {{recipientName}}? Send them a treat 🎁

**HTML Body:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; background: #fff3cd; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 30px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
    .code { background: #d4edda; padding: 15px 25px; font-size: 20px; font-weight: bold; border-radius: 5px; display: inline-block; margin: 15px 0; border: 2px dashed #28a745; }
    .urgency { background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎁 It's Been a Week!</h1>
    </div>

    <div class="content">
      <p>Hi {{customerName}},</p>

      <p>It's been a week since you sent food to <strong>{{recipientName}}</strong> in <strong>{{recipientCity}}</strong>.</p>

      <p>We bet they'd love another surprise! 😊</p>

      <div class="urgency">
        ⏰ <strong>Special Offer:</strong> $3 off your next order (expires in 3 days)
      </div>

      <div style="text-align: center;">
        <div class="code">COMEBACK3</div>
      </div>

      <p><strong>Popular restaurants in {{recipientCity}}:</strong></p>
      <ul>
        {{#each popularRestaurants}}
        <li>{{this}}</li>
        {{/each}}
      </ul>

      <div style="text-align: center; margin-top: 30px;">
        <a href="{{reorderUrl}}" class="button">Reorder Same Meal</a>
        <a href="{{browseUrl}}" class="button" style="background: #007bff;">Browse Restaurants</a>
      </div>
    </div>

    <div class="footer">
      <p>- The FoodToIndia Team</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a> | <a href="https://foodtoindia.com">Visit Website</a></p>
    </div>
  </div>
</body>
</html>
```

**Dynamic Variables:**
- `{{customerName}}` - Customer's first name
- `{{recipientName}}` - Recipient's first name
- `{{recipientCity}}` - Recipient's city
- `{{popularRestaurants}}` - Array of restaurant names
- `{{reorderUrl}}` - Link to reorder
- `{{browseUrl}}` - Link to browse restaurants
- `{{unsubscribeUrl}}` - Unsubscribe link

---

### Template 3: Day 30 Win-Back

**SendGrid Template ID:** `d-day30-winback`

**Subject:** They're probably hungry by now... 😊

**HTML Body:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 8px; }
    .button { display: inline-block; padding: 15px 40px; background: #dc3545; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; margin: 20px 0; }
    .code { background: #f8d7da; padding: 20px 30px; font-size: 24px; font-weight: bold; border-radius: 5px; display: inline-block; margin: 15px 0; border: 3px solid #dc3545; }
    .social-proof { background: #e7f3ff; padding: 20px; border-left: 4px solid #007bff; margin: 20px 0; font-style: italic; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>👋 We Miss You!</h1>
    </div>

    <div class="content">
      <p>Hi {{customerName}},</p>

      <p>It's been a month since you sent food to <strong>{{recipientName}}</strong>.</p>

      <p>They're probably wondering when the next delicious meal is coming! 😄</p>

      <div class="social-proof">
        💡 <strong>Did you know?</strong> Our customers send food an average of 5-6 times. Many send weekly to stay connected with loved ones!
      </div>

      <p><strong>We're here to make it easy:</strong></p>
      <p>Here's $5 to send them a surprise:</p>

      <div style="text-align: center;">
        <div class="code">MONTH5</div>
        <p style="color: #dc3545; font-weight: bold;">⚠️ Expires in 7 days!</p>
      </div>

      <div style="text-align: center; margin-top: 30px;">
        <a href="{{reorderUrl}}" class="button">Send Food Now →</a>
      </div>

      <p style="margin-top: 30px; font-size: 14px; color: #666;">
        <strong>Pro tip:</strong> Save their address and favorite restaurants for even faster ordering next time!
      </p>
    </div>

    <div class="footer">
      <p>- The FoodToIndia Team</p>
      <p>P.S. If you're not interested in these reminders, <a href="{{unsubscribeUrl}}">let us know</a>.</p>
    </div>
  </div>
</body>
</html>
```

---

### Template 4: Birthday Reminder

**SendGrid Template ID:** `d-birthday-reminder`

**Subject:** 🎂 {{recipientName}}'s birthday is in 7 days!

**HTML Body:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 15px 40px; background: #6f42c1; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; margin: 10px 5px; }
    .code { background: #e7d9f7; padding: 15px 25px; font-size: 20px; font-weight: bold; border-radius: 5px; display: inline-block; margin: 15px 0; }
    .item-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
    .item-card { background: white; padding: 15px; border-radius: 5px; text-align: center; border: 1px solid #ddd; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎂🎉🎁</h1>
      <h2>Birthday Coming Up!</h2>
    </div>

    <div class="content">
      <p>Hi {{customerName}},</p>

      <p><strong>{{recipientName}}'s birthday is in 7 days!</strong> ({{birthdayDate}})</p>

      <p>Make their day special with a delicious treat from {{recipientCity}}! 🎉</p>

      <p><strong>🎁 Birthday Special:</strong> 10% off all birthday orders</p>

      <div style="text-align: center;">
        <div class="code">BDAY10</div>
      </div>

      <p><strong>Popular birthday items in {{recipientCity}}:</strong></p>

      <div class="item-grid">
        {{#each birthdayItems}}
        <div class="item-card">
          <div style="font-size: 30px;">{{this.emoji}}</div>
          <div style="font-weight: bold;">{{this.name}}</div>
          <div style="color: #666; font-size: 14px;">{{this.restaurant}}</div>
        </div>
        {{/each}}
      </div>

      <div style="text-align: center; margin-top: 30px;">
        <a href="{{orderCakeUrl}}" class="button">Order Birthday Cake 🎂</a>
        <a href="{{browseSweetsUrl}}" class="button" style="background: #28a745;">Browse Sweets 🍬</a>
      </div>

      <p style="margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
        🚚 Most restaurants in {{recipientCity}} deliver same-day!
      </p>
    </div>

    <div class="footer">
      <p>Make birthdays special, from anywhere in the world ❤️</p>
      <p>- The FoodToIndia Team</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```

---

### Template 5: Care Streak Reminder

**SendGrid Template ID:** `d-care-streak-reminder`

**Subject:** 🔥 Don't break your {{streakWeeks}}-week care streak!

**HTML Body:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 8px 8px 0 0; }
    .streak-number { font-size: 72px; font-weight: bold; margin: 20px 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 15px 40px; background: #ff6b35; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; margin: 20px 0; }
    .progress-bar { background: #e9ecef; height: 30px; border-radius: 15px; overflow: hidden; margin: 20px 0; }
    .progress-fill { background: linear-gradient(90deg, #ff6b35 0%, #f7931e 100%); height: 100%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; }
    .reward-box { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔥 CARE STREAK ALERT 🔥</h1>
      <div class="streak-number">{{streakWeeks}}</div>
      <p style="font-size: 18px;">Consecutive Weeks</p>
    </div>

    <div class="content">
      <p>Hi {{customerName}},</p>

      <p>You've been sending food to <strong>{{recipientName}}</strong> for {{streakWeeks}} weeks straight! That's amazing! 👏</p>

      <p><strong>⚠️ But your streak is at risk!</strong></p>
      <p>You haven't sent anything this week yet. Send an order in the next 2 days to keep your streak alive!</p>

      <div class="reward-box">
        🎁 <strong>Next Reward:</strong><br>
        Reach week {{nextMilestone}} to earn {{nextReward}}!
      </div>

      <p><strong>Progress to Next Reward:</strong></p>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {{progressPercent}}%;">
          {{streakWeeks}} / {{nextMilestone}} weeks
        </div>
      </div>

      <p><strong>Keep the streak going!</strong> Here's what {{recipientName}} loves:</p>
      <ul>
        {{#each favoriteRestaurants}}
        <li>{{this}}</li>
        {{/each}}
      </ul>

      <div style="text-align: center;">
        <a href="{{reorderUrl}}" class="button">Send This Week →</a>
      </div>

      <p style="margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
        Last order: {{daysSinceLastOrder}} days ago
      </p>
    </div>

    <div class="footer">
      <p>You're doing great! Keep showing you care ❤️</p>
      <p>- The FoodToIndia Team</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```

---

### Template 6: Referral Invite

**SendGrid Template ID:** `d-referral-invite`

**Subject:** Give $5, Get $5 - Share FoodToIndia 🎁

**HTML Body:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px; background: #28a745; color: white; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .referral-box { background: white; border: 2px dashed #28a745; padding: 25px; border-radius: 8px; margin: 20px 0; text-align: center; }
    .referral-link { background: #e7f3ff; padding: 15px; font-size: 18px; font-weight: bold; border-radius: 5px; word-break: break-all; margin: 10px 0; display: block; }
    .button { display: inline-block; padding: 12px 30px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 5px; }
    .how-it-works { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎁 Share the Love!</h1>
      <p style="font-size: 18px;">Give $5, Get $5</p>
    </div>

    <div class="content">
      <p>Hi {{customerName}},</p>

      <p>Love sending food to your loved ones in India? Your friends will too!</p>

      <p><strong>Here's the deal:</strong></p>

      <div class="how-it-works">
        <h3 style="margin-top: 0;">How It Works:</h3>
        <ol style="text-align: left;">
          <li>Share your unique referral link below</li>
          <li>Your friend signs up and places their first order</li>
          <li>They get <strong>$5 off</strong> their order</li>
          <li>You get <strong>$5 credit</strong> automatically!</li>
        </ol>
      </div>

      <div class="referral-box">
        <p style="margin-top: 0;"><strong>Your Unique Referral Link:</strong></p>
        <div class="referral-link">{{referralLink}}</div>

        <div style="margin-top: 20px;">
          <a href="{{shareEmailUrl}}" class="button">📧 Share via Email</a>
          <a href="{{shareWhatsAppUrl}}" class="button" style="background: #25D366;">💬 Share via WhatsApp</a>
        </div>

        <button onclick="navigator.clipboard.writeText('{{referralLink}}')" class="button" style="background: #6c757d;">
          📋 Copy Link
        </button>
      </div>

      <p><strong>Your Referral Stats:</strong></p>
      <ul>
        <li>Total Referrals: {{totalReferred}}</li>
        <li>Total Earned: ${{totalEarned}}</li>
      </ul>

      <p style="margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
        💡 <strong>Tip:</strong> Share with family and friends who have loved ones in India!
      </p>
    </div>

    <div class="footer">
      <p>Share the joy of sending food to India! 🇮🇳</p>
      <p>- The FoodToIndia Team</p>
      <p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```

---

## Analytics & Tracking

### Key Metrics to Track

**Email Performance:**
```javascript
// Track in Firestore
emailAnalytics/{campaignId} {
  campaignName: string,
  sentDate: timestamp,
  totalSent: number,
  totalOpened: number,
  totalClicked: number,
  totalConverted: number,  // Placed order
  openRate: number,
  clickRate: number,
  conversionRate: number,
  revenue: number  // Revenue from converted orders
}
```

**Customer Metrics:**
```javascript
// Track per user
users/{uid}/analytics {
  // Retention
  repeatPurchaseRate: number,
  daysBetween1stAnd2ndOrder: number,
  totalOrders: number,

  // Engagement
  emailsOpened: number,
  emailsClicked: number,
  lastEmailOpened: timestamp,

  // Referral
  referralsGenerated: number,
  referralRevenue: number,

  // Streak
  currentStreak: number,
  longestStreak: number,
  streakBroken: number,  // Times streak was broken

  // Segment
  segment: string,
  segmentHistory: [
    { segment: string, startDate: timestamp, endDate: timestamp }
  ]
}
```

### Dashboard Views

**Admin Dashboard - Retention Tab:**

```
┌─────────────────────────────────────────────────────┐
│          CUSTOMER RETENTION DASHBOARD               │
├─────────────────────────────────────────────────────┤
│                                                     │
│  📊 KEY METRICS (Last 30 Days)                     │
│  ┌──────────────┬──────────────┬──────────────┐   │
│  │ Repeat Rate  │ Days to 2nd  │ Avg Orders   │   │
│  │    62.4%     │   18 days    │    6.8       │   │
│  │    ↑ 12%     │   ↓ 12 days  │    ↑ 1.05    │   │
│  └──────────────┴──────────────┴──────────────┘   │
│                                                     │
│  📧 EMAIL CAMPAIGNS                                │
│  Campaign           Sent   Open%  Click%  Conv%    │
│  ──────────────────────────────────────────────    │
│  Day 1 Follow-Up    142    38%    12%     8%       │
│  Day 7 Come Back     89    35%    10%     6%       │
│  Day 30 Win-Back     67    28%     7%     4%       │
│  Birthday Reminder   23    52%    28%    18%       │
│  Care Streak         45    44%    15%    11%       │
│                                                     │
│  🎯 SEGMENTS                                       │
│  Segment            Count   Revenue  Avg Order     │
│  ──────────────────────────────────────────────    │
│  VIP                  12   $3,245    $27.04       │
│  Loving Child         38   $5,892    $15.50       │
│  Multi-City Gifter    15   $2,104    $14.03       │
│  Active               85   $4,567    $10.72       │
│  At-Risk              52   $1,234     $8.95       │
│  One-Time            135      $0        $0        │
│                                                     │
│  🔥 CARE STREAKS                                   │
│  Active Streaks: 42 customers                      │
│  Avg Streak: 6.2 weeks                            │
│  At Risk Today: 18 customers (need order)         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Google Analytics Integration

**Track Events:**
```javascript
// Email opens
gtag('event', 'email_open', {
  campaign_name: 'day_7_comeback',
  user_id: userId
});

// Email clicks
gtag('event', 'email_click', {
  campaign_name: 'day_7_comeback',
  user_id: userId,
  cta: 'reorder_button'
});

// Conversions
gtag('event', 'purchase', {
  transaction_id: orderId,
  value: orderValue,
  currency: 'USD',
  from_campaign: 'day_7_comeback'
});

// Care streak milestones
gtag('event', 'care_streak_milestone', {
  user_id: userId,
  streak_weeks: 8,
  reward_earned: 'free_dessert'
});
```

---

## Budget & Resources

### Cost Breakdown

| Item | Monthly Cost | Annual Cost | Notes |
|------|-------------|-------------|-------|
| **SendGrid** | $0 - $15 | $0 - $180 | Free tier: 100 emails/day<br>Essential: $15/mo for 50K emails |
| **Firebase Functions** | $5 - $10 | $60 - $120 | ~1M invocations/month |
| **Domain Email** | $6 | $72 | Google Workspace (optional) |
| **Design Tools** | $0 | $0 | Use Canva free tier |
| **TOTAL** | **$11 - $31** | **$132 - $372** | |

### Free Tier Limits

**SendGrid Free Tier:**
- 100 emails/day = 3,000/month
- Enough for: ~300 customers with 10 emails each per month
- Upgrade when: Customer base > 300 or email volume > 3K/month

**Firebase Free Tier (Spark Plan):**
- 125K function invocations/day
- 40K GB-seconds/month
- Should be sufficient for initial rollout

**Recommendation:** Start on free tiers, monitor usage, upgrade as needed.

---

### Resource Requirements

**Development Time:**

| Phase | Tasks | Estimated Hours | Developer |
|-------|-------|----------------|-----------|
| Phase 1 | Email sequence, Quick actions, Birthday collection | 16-20 hours | Full-stack |
| Phase 2 | Birthday reminders, Festivals, Abandoned cart | 12-16 hours | Full-stack |
| Phase 3 | Care streaks, Referral program | 16-20 hours | Full-stack |
| Phase 4 | Segmentation, Targeted campaigns | 8-12 hours | Full-stack |
| **TOTAL** | | **52-68 hours** | **~2-3 weeks** |

**Maintenance:**
- **Weekly:** Monitor email performance, adjust copy (1-2 hours)
- **Monthly:** Analyze retention metrics, update segments (2-3 hours)
- **Quarterly:** Review and optimize campaigns (4-6 hours)

---

## Success Criteria & Next Steps

### Phase 1 Success (Week 2)
- [ ] All 3 email sequences deployed
- [ ] "Send Again" button in emails
- [ ] Birthday collection at checkout
- [ ] At least 50 emails sent
- [ ] 30%+ open rate achieved

### Phase 2 Success (Week 4)
- [ ] Birthday reminders sent (at least 5)
- [ ] Festival campaign created (upcoming festival)
- [ ] Abandoned cart recovery working
- [ ] 5%+ conversion from emails

### Phase 3 Success (Month 2)
- [ ] Care streak system live
- [ ] 20+ customers with active streaks
- [ ] Referral program launched
- [ ] 10+ referrals generated

### Phase 4 Success (Month 3)
- [ ] All segments defined and auto-updating
- [ ] Segment-specific campaigns sent
- [ ] **Primary Goal: 65% repeat rate achieved**
- [ ] **Secondary Goal: 14-day avg to 2nd order**

### Go-Live Checklist

**Before Launch:**
- [ ] SendGrid account created & verified
- [ ] Email templates designed & tested
- [ ] Firebase Functions deployed to staging
- [ ] Test emails sent to team
- [ ] Analytics tracking verified
- [ ] Unsubscribe flow working
- [ ] Legal review (GDPR, CAN-SPAM compliance)
- [ ] Support team trained on new features

**Week 1:**
- [ ] Deploy to 10% of users (A/B test)
- [ ] Monitor email deliverability
- [ ] Check for bugs/errors
- [ ] Gather initial feedback

**Week 2:**
- [ ] Deploy to 50% of users
- [ ] Analyze early metrics
- [ ] Adjust copy based on performance

**Week 3:**
- [ ] Deploy to 100% of users
- [ ] Full rollout announcement
- [ ] Monitor and optimize

---

## Appendix

### A. Email Best Practices

**Subject Lines:**
- Keep under 50 characters
- Use personalization ({{firstName}})
- Include emojis (increases opens by 10-15%)
- Create urgency when appropriate ("Expires in 3 days")
- A/B test different approaches

**Email Body:**
- Mobile-first design (60% open on mobile)
- Single clear CTA per email
- Use social proof
- Keep paragraphs short (2-3 lines max)
- Include images sparingly (affects load time)

**Send Time Optimization:**
- Best days: Tuesday, Wednesday, Thursday
- Best time: 9-11 AM recipient's timezone
- Avoid: Monday mornings, Friday afternoons, weekends

**Deliverability:**
- Authenticate domain (SPF, DKIM, DMARC)
- Monitor spam complaints (<0.1%)
- Clean email list regularly
- Avoid spam trigger words
- Include physical address in footer

---

### B. GDPR & Compliance

**Required Elements:**
- [ ] Clear opt-in during signup
- [ ] Easy unsubscribe in every email
- [ ] Privacy policy link
- [ ] Data retention policy
- [ ] Right to deletion (account settings)

**Unsubscribe Flow:**
```
User clicks "Unsubscribe" →
Land on preference center:
  ☑ Marketing emails
  ☑ Order updates
  ☑ Birthday reminders

[Update Preferences] [Unsubscribe from All]
```

---

### C. Testing Plan

**A/B Tests to Run:**

| Test | Variant A | Variant B | Metric |
|------|-----------|-----------|--------|
| Subject line | "Missing {{name}}?" | "Send food to {{name}}?" | Open rate |
| Discount | $3 off | 15% off | Conversion |
| CTA text | "Send Again" | "Reorder Now" | Click rate |
| Send time | 9 AM | 7 PM | Open rate |
| Urgency | "Expires in 3 days" | No urgency | Conversion |

---

### D. Glossary

| Term | Definition |
|------|------------|
| **Open Rate** | % of delivered emails that were opened |
| **Click Rate (CTR)** | % of delivered emails where link was clicked |
| **Conversion Rate** | % of email recipients who placed an order |
| **Churn** | Customer who hasn't ordered in 60+ days |
| **LTV** | Lifetime Value - total revenue from a customer |
| **AOV** | Average Order Value |
| **Care Streak** | Consecutive weeks sending food |
| **Segment** | Group of customers with similar behavior |
| **Win-Back** | Campaign to re-engage churned customers |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 13, 2026 | Product Team | Initial draft |
| | | | |

**Approvals:**
- [ ] Product Manager
- [ ] Engineering Lead
- [ ] Marketing Lead
- [ ] Legal/Compliance

**Next Review Date:** February 13, 2026

---

*For questions or feedback on this PRD, contact: product@foodtoindia.com*
