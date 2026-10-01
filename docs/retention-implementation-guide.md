# Retention Campaigns - Quick Implementation Guide

**For Developers**

This is a condensed, action-oriented guide to implement the retention campaigns. For full details, see [retention-campaigns-prd.md](./retention-campaigns-prd.md).

---

## Quick Start (Phase 1 - Week 1)

### 1. Setup SendGrid

```bash
# Install SendGrid
cd functions
npm install @sendgrid/mail

# Get API key from SendGrid dashboard
# Store in Firebase config
firebase functions:config:set sendgrid.key="YOUR_API_KEY_HERE"
firebase functions:config:set sendgrid.from="care@foodtoindia.com"
```

### 2. Create Email Templates in SendGrid

Go to SendGrid Dashboard → Email API → Dynamic Templates

Create these templates:
1. **Day 1 Follow-Up** - Get template ID (e.g., `d-abc123...`)
2. **Day 7 Come Back** - Get template ID
3. **Day 30 Win-Back** - Get template ID

Copy template HTML from PRD section "Email Templates".

### 3. Add Email Helper Function

Create `functions/email/sendEmail.js`:

```javascript
const sgMail = require('@sendgrid/mail');
const functions = require('firebase-functions');

sgMail.setApiKey(functions.config().sendgrid.key);

const TEMPLATES = {
  DAY_1_FOLLOWUP: 'd-YOUR-TEMPLATE-ID-HERE',
  DAY_7_COMEBACK: 'd-YOUR-TEMPLATE-ID-HERE',
  DAY_30_WINBACK: 'd-YOUR-TEMPLATE-ID-HERE',
};

async function sendEmail(to, templateId, dynamicData) {
  const msg = {
    to: to,
    from: functions.config().sendgrid.from,
    templateId: templateId,
    dynamicTemplateData: {
      ...dynamicData,
      unsubscribeUrl: `https://foodtoindia.com/unsubscribe?email=${encodeURIComponent(to)}`
    },
    trackingSettings: {
      clickTracking: { enable: true },
      openTracking: { enable: true }
    }
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Email sent to ${to}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}

module.exports = { sendEmail, TEMPLATES };
```

### 4. Day 1 Email (Triggered on Order Status = Dispatched)

Create `functions/triggers/onOrderDispatched.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { sendEmail, TEMPLATES } = require('../email/sendEmail');

exports.onOrderDispatched = functions.firestore
  .document('users/{userId}/orders/{orderId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only trigger when status changes to "dispatched"
    if (before.status !== 'dispatched' && after.status === 'dispatched') {
      const userId = context.params.userId;
      const orderId = context.params.orderId;

      // Get user data
      const userDoc = await admin.firestore().collection('users').doc(userId).get();
      const user = userDoc.data();

      // Check if this is their first order
      const ordersSnapshot = await admin.firestore()
        .collection('users')
        .doc(userId)
        .collection('orders')
        .get();

      const orderCount = ordersSnapshot.size;

      if (orderCount === 1) {
        // Send Day 1 email after 24 hours
        const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await admin.firestore().collection('scheduledEmails').add({
          userId: userId,
          orderId: orderId,
          email: user.email,
          type: 'day_1_followup',
          scheduledFor: scheduledTime,
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`📅 Day 1 email scheduled for ${user.email}`);
      }
    }
  });
```

### 5. Scheduled Email Processor

Create `functions/scheduled/processScheduledEmails.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { sendEmail, TEMPLATES } = require('../email/sendEmail');

exports.processScheduledEmails = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();

    // Get all emails that should be sent
    const emailsSnapshot = await admin.firestore()
      .collection('scheduledEmails')
      .where('sent', '==', false)
      .where('scheduledFor', '<=', now.toDate())
      .limit(50)
      .get();

    if (emailsSnapshot.empty) {
      console.log('No emails to send');
      return;
    }

    console.log(`📧 Processing ${emailsSnapshot.size} scheduled emails`);

    for (const emailDoc of emailsSnapshot.docs) {
      const emailData = emailDoc.data();

      try {
        // Get order details
        const orderDoc = await admin.firestore()
          .collection('users')
          .doc(emailData.userId)
          .collection('orders')
          .doc(emailData.orderId)
          .get();

        const order = orderDoc.data();

        // Get user details
        const userDoc = await admin.firestore()
          .collection('users')
          .doc(emailData.userId)
          .get();

        const user = userDoc.data();

        // Send email based on type
        if (emailData.type === 'day_1_followup') {
          await sendEmail(emailData.email, TEMPLATES.DAY_1_FOLLOWUP, {
            customerName: user.displayName || user.email.split('@')[0],
            recipientName: order.recipient?.name || 'your recipient',
            restaurantName: order.restaurantName || 'the restaurant',
            feedbackUrl: `https://foodtoindia.com/feedback?orderId=${emailData.orderId}`,
            reorderUrl: `https://foodtoindia.com/reorder?orderId=${emailData.orderId}`
          });
        }

        // Mark as sent
        await emailDoc.ref.update({
          sent: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`✅ Sent ${emailData.type} to ${emailData.email}`);

      } catch (error) {
        console.error(`❌ Failed to send email ${emailDoc.id}:`, error);

        // Mark as failed
        await emailDoc.ref.update({
          failed: true,
          error: error.message,
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  });
```

### 6. Day 7 & Day 30 Checker

Create `functions/scheduled/checkRetentionEmails.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');

exports.checkRetentionEmails = functions.pubsub
  .schedule('every day 09:00')
  .timeZone('America/New_York')  // Adjust to your timezone
  .onRun(async (context) => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get all users
    const usersSnapshot = await admin.firestore().collection('users').get();

    console.log(`Checking ${usersSnapshot.size} users for retention emails`);

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const user = userDoc.data();

      // Get order count
      const ordersSnapshot = await admin.firestore()
        .collection('users')
        .doc(userId)
        .collection('orders')
        .get();

      // Skip if already a repeat customer
      if (ordersSnapshot.size > 1) continue;

      // Get first order
      const firstOrderDoc = ordersSnapshot.docs[0];
      if (!firstOrderDoc) continue;

      const firstOrder = firstOrderDoc.data();
      const firstOrderDate = firstOrder.createdAt?.toDate();

      if (!firstOrderDate) continue;

      // Calculate days since first order
      const daysSinceFirst = Math.floor((now - firstOrderDate) / (1000 * 60 * 60 * 24));

      // Check if Day 7 email needed
      if (daysSinceFirst === 7) {
        // Check if already sent
        const day7Sent = user.emailCampaigns?.day7Sent;
        if (day7Sent) continue;

        // Schedule Day 7 email
        await admin.firestore().collection('scheduledEmails').add({
          userId: userId,
          orderId: firstOrderDoc.id,
          email: user.email,
          type: 'day_7_comeback',
          scheduledFor: now,
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mark as scheduled
        await userDoc.ref.update({
          'emailCampaigns.day7Sent': admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`📧 Scheduled Day 7 email for ${user.email}`);
      }

      // Check if Day 30 email needed
      if (daysSinceFirst === 30) {
        // Check if already sent
        const day30Sent = user.emailCampaigns?.day30Sent;
        if (day30Sent) continue;

        // Schedule Day 30 email
        await admin.firestore().collection('scheduledEmails').add({
          userId: userId,
          orderId: firstOrderDoc.id,
          email: user.email,
          type: 'day_30_winback',
          scheduledFor: now,
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mark as scheduled
        await userDoc.ref.update({
          'emailCampaigns.day30Sent': admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`📧 Scheduled Day 30 email for ${user.email}`);
      }
    }

    console.log('✅ Retention email check complete');
  });
```

### 7. Update functions/index.js

```javascript
const admin = require('firebase-admin');
admin.initializeApp();

// Triggers
exports.onOrderDispatched = require('./triggers/onOrderDispatched').onOrderDispatched;

// Scheduled
exports.processScheduledEmails = require('./scheduled/processScheduledEmails').processScheduledEmails;
exports.checkRetentionEmails = require('./scheduled/checkRetentionEmails').checkRetentionEmails;
```

### 8. Deploy

```bash
# Deploy functions
firebase deploy --only functions

# Check logs
firebase functions:log
```

---

## Testing

### Test Day 1 Email

```bash
# Create a test order and mark as dispatched
# Email should be scheduled for 24 hours later

# To test immediately, update scheduled time:
# Go to Firebase Console → Firestore → scheduledEmails
# Change scheduledFor to current time
# Wait 15 minutes for scheduled function to run
```

### Test Day 7 & 30 Emails

```bash
# Manually trigger the scheduled function
firebase functions:shell

# Then run:
checkRetentionEmails()
```

---

## Add "Send Again" Button to Emails

### Update Order Confirmation Email

Add this to your existing order confirmation email template:

```html
<div style="text-align: center; margin: 30px 0;">
  <a href="https://foodtoindia.com/reorder?orderId={{orderId}}"
     style="display: inline-block;
            padding: 12px 30px;
            background: #ff6b35;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;">
    Send Same Order Again →
  </a>
</div>
```

### Create Reorder API Endpoint

Create `pages/api/reorder.js`:

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderId } = req.body;

  // Get order from Firestore
  // ... fetch order logic

  // Return order data to pre-fill cart
  return res.status(200).json({
    success: true,
    order: {
      recipient: order.recipient,
      restaurant: order.restaurant,
      items: order.lineItems
    }
  });
}
```

---

## Monitoring & Analytics

### Check Email Stats

```javascript
// In Firebase Console, create this query:

// Collection: scheduledEmails
// Filters:
//   - type == 'day_1_followup'
//   - sent == true
//   - sentAt >= [last 7 days]

// Count = emails sent
// Check SendGrid dashboard for open/click rates
```

### Track Conversions

Add to your order creation code:

```javascript
// When user places order, check if from email campaign
const urlParams = new URLSearchParams(window.location.search);
const fromCampaign = urlParams.get('campaign');

if (fromCampaign) {
  // Track in analytics
  gtag('event', 'conversion', {
    campaign: fromCampaign
  });

  // Store in order metadata
  orderData.metadata = {
    ...orderData.metadata,
    fromCampaign: fromCampaign
  };
}
```

---

## Troubleshooting

### Emails Not Sending

1. Check SendGrid API key is set:
   ```bash
   firebase functions:config:get
   ```

2. Check scheduled emails collection:
   ```javascript
   // Should have docs with sent: false
   ```

3. Check function logs:
   ```bash
   firebase functions:log
   ```

### Emails Going to Spam

1. Verify domain in SendGrid
2. Set up SPF/DKIM records
3. Warm up sending (start with small batches)

### Function Timeout

If processing too many emails:
```javascript
// Reduce batch size in processScheduledEmails
.limit(10)  // Instead of 50
```

---

## Quick Reference

### Firestore Collections

```
users/{uid}
  - emailCampaigns: { day1Sent, day7Sent, day30Sent }
  - orders/{orderId}
  - recipients/{recipientId}

scheduledEmails/{emailId}
  - userId
  - email
  - type
  - scheduledFor
  - sent
  - sentAt
```

### Cloud Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| onOrderDispatched | Firestore update | Schedule Day 1 email |
| processScheduledEmails | Every 15 min | Send queued emails |
| checkRetentionEmails | Daily 9 AM | Schedule Day 7 & 30 emails |

### SendGrid Templates

| Template | When Sent | Discount |
|----------|-----------|----------|
| Day 1 Follow-Up | 24h after dispatch | $2 off (CAREFAM2) |
| Day 7 Come Back | 7 days after 1st order | $3 off (COMEBACK3) |
| Day 30 Win-Back | 30 days after 1st order | $5 off (MONTH5) |

---

## Next Steps (Phase 2)

Once Phase 1 is working:

1. **Birthday Reminders**
   - Add birthday field to recipients
   - Create scheduled function to check birthdays
   - Create birthday email template

2. **Abandoned Cart Recovery**
   - Track when user adds items to cart
   - Save cart data
   - Send recovery email after 15 min

3. **Festival Campaigns**
   - Create festival calendar
   - Send targeted emails before festivals
   - Segment by recipient location

See [retention-campaigns-prd.md](./retention-campaigns-prd.md) for full details.

---

## Support

For questions:
- Check PRD: [retention-campaigns-prd.md](./retention-campaigns-prd.md)
- SendGrid Docs: https://docs.sendgrid.com/
- Firebase Functions: https://firebase.google.com/docs/functions

---

*Last Updated: January 13, 2026*
