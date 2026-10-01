import { db, admin } from '../../lib/firebase';
// Note: You'll need to install and configure Resend
// npm install resend
// Add RESEND_API_KEY to your .env.local

import { requireAuth } from '../../lib/withAuth';

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (!db) {
    return res.status(500).json({
      error: 'Firebase not initialized',
      message: 'Please check your Firebase configuration in .env.local'
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await listCampaigns(req, res);
      case 'POST':
        return await createOrSendCampaign(req, res);
      case 'PUT':
        return await updateCampaign(req, res);
      case 'DELETE':
        return await deleteCampaign(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Email campaigns API error:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      message: error.message,
    });
  }
}

async function listCampaigns(req, res) {
  const snapshot = await db.collection('email-campaigns')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const campaigns = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
    sentAt: doc.data().sentAt?.toDate?.()?.toISOString() || doc.data().sentAt,
  }));

  return res.status(200).json({ campaigns });
}

async function createOrSendCampaign(req, res) {
  const {
    action, // 'save', 'test', or 'send'
    campaignId, // for 'test' or 'send' actions on existing campaign
    name,
    templateId,
    templateSlug,
    subject,
    variables,
    cohort,
    recipientEmails, // for test sends
    promoCode,
    ctaUrl,
  } = req.body;

  // Test send
  if (action === 'test') {
    return await sendTestEmail(req, res, {
      templateId,
      subject,
      variables,
      recipientEmails,
    });
  }

  // Production send
  if (action === 'send') {
    return await sendCampaign(req, res, {
      campaignId,
      templateId,
      subject,
      variables,
      cohort,
    });
  }

  // Save campaign (draft)
  if (!name || !templateId || !subject) {
    return res.status(400).json({ error: 'Name, template, and subject are required' });
  }

  const campaignData = {
    name: name.trim(),
    templateId,
    templateSlug: templateSlug || '',
    subject: subject.trim(),
    variables: variables || {},
    cohort: cohort || 'all',
    promoCode: promoCode || '',
    ctaUrl: ctaUrl || '',
    status: 'draft',
    recipientCount: 0,
    sentCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('email-campaigns').add(campaignData);

  return res.status(201).json({
    id: docRef.id,
    ...campaignData,
    createdAt: new Date().toISOString(),
  });
}

async function sendTestEmail(req, res, { templateId, subject, variables, recipientEmails }) {
  if (!recipientEmails || recipientEmails.length === 0) {
    return res.status(400).json({ error: 'At least one test email is required' });
  }

  // Get template
  const templateDoc = await db.collection('email-templates').doc(templateId).get();
  if (!templateDoc.exists) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const template = templateDoc.data();

  // Replace variables in HTML
  let html = template.htmlContent;
  Object.entries(variables || {}).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    html = html.replace(regex, value ?? '');
  });
  // Clean up empty greetings (e.g., "Hi ," → "Hey,")
  html = html.replace(/(Hi|Hey|Hello)\s+,/g, 'Hey,');

  // Replace variables in subject
  let finalSubject = subject || template.subject;
  Object.entries(variables || {}).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    finalSubject = finalSubject.replace(regex, value ?? '');
  });

  // Check if Resend is configured
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    // Mock send for development
    console.log('=== TEST EMAIL (MOCK - No Resend API Key) ===');
    console.log('To:', recipientEmails.join(', '));
    console.log('Subject:', finalSubject);
    console.log('Template:', template.name);
    console.log('Variables:', JSON.stringify(variables, null, 2));
    console.log('==============================================');

    return res.status(200).json({
      success: true,
      message: `Test email logged (Resend not configured). Check server console.`,
      mock: true,
      recipients: recipientEmails,
    });
  }

  // Send via Resend
  try {
    const { Resend } = require('resend');
    const resend = new Resend(RESEND_API_KEY);

    const results = await Promise.all(
      recipientEmails.map(async (email) => {
        try {
          const result = await resend.emails.send({
            from: 'FoodtoIndia <hello@foodtoindia.com>',
            to: email,
            subject: `[TEST] ${finalSubject}`,
            html: html,
          });
          return { email, success: true, id: result.id };
        } catch (err) {
          return { email, success: false, error: err.message };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;

    return res.status(200).json({
      success: successCount > 0,
      message: `Sent ${successCount}/${recipientEmails.length} test emails`,
      results,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to send test email',
      message: err.message,
    });
  }
}

async function sendCampaign(req, res, { campaignId, templateId, subject, variables, cohort }) {
  // Get template
  const templateDoc = await db.collection('email-templates').doc(templateId).get();
  if (!templateDoc.exists) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const template = templateDoc.data();

  // Get recipients based on cohort
  const recipients = await getRecipientsByCohort(cohort);

  if (recipients.length === 0) {
    return res.status(400).json({ error: 'No recipients found for this cohort' });
  }

  // Check if Resend is configured
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    return res.status(400).json({
      error: 'Resend API key not configured',
      message: 'Add RESEND_API_KEY to your .env.local file to send production emails',
    });
  }

  // Create campaign record
  const campaignData = {
    templateId,
    templateSlug: template.slug,
    subject,
    variables: variables || {},
    cohort,
    status: 'sending',
    recipientCount: recipients.length,
    sentCount: 0,
    failedCount: 0,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  let campaignRef;
  if (campaignId) {
    campaignRef = db.collection('email-campaigns').doc(campaignId);
    await campaignRef.update(campaignData);
  } else {
    campaignRef = await db.collection('email-campaigns').add({
      ...campaignData,
      name: `${template.name} - ${new Date().toLocaleDateString()}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // Send emails in batches
  const { Resend } = require('resend');
  const resend = new Resend(RESEND_API_KEY);

  let sentCount = 0;
  let failedCount = 0;
  const batchSize = 10;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (recipient) => {
        try {
          // Personalize email for each recipient
          let html = template.htmlContent;
          let finalSubject = subject || template.subject;

          // Replace standard variables
          const personalizedVars = {
            ...variables,
            EMAIL: recipient.email,
          };

          // Only personalize FIRST_NAME if admin provided a non-empty value
          if (variables.FIRST_NAME) {
            personalizedVars.FIRST_NAME = recipient.firstName || recipient.name?.split(' ')[0] || '';
          }

          Object.entries(personalizedVars).forEach(([key, value]) => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            html = html.replace(regex, value ?? '');
            finalSubject = finalSubject.replace(regex, value ?? '');
          });

          // Clean up empty greetings (e.g., "Hi ," → "Hey,")
          html = html.replace(/(Hi|Hey|Hello)\s+,/g, 'Hey,');

          await resend.emails.send({
            from: 'FoodtoIndia <hello@foodtoindia.com>',
            to: recipient.email,
            subject: finalSubject,
            html: html,
          });

          sentCount++;
        } catch (err) {
          console.error(`Failed to send to ${recipient.email}:`, err.message);
          failedCount++;
        }
      })
    );

    // Update progress
    await campaignRef.update({
      sentCount,
      failedCount,
    });
  }

  // Mark campaign as complete
  await campaignRef.update({
    status: 'sent',
    sentCount,
    failedCount,
  });

  return res.status(200).json({
    success: true,
    message: `Campaign sent: ${sentCount} delivered, ${failedCount} failed`,
    sentCount,
    failedCount,
    totalRecipients: recipients.length,
  });
}

async function getRecipientsByCohort(cohort) {
  const usersRef = db.collection('users');
  let query = usersRef;

  // Define cohort filters based on the customer segments from the Customers page
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // For simplicity, we'll fetch all users and filter in memory
  // In production, you'd want more sophisticated Firestore queries
  const snapshot = await usersRef.get();
  const users = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    if (!data.email) return; // Skip users without email

    // IMPORTANT: Skip unsubscribed users (respect email preferences)
    if (data.emailPreferences?.unsubscribed === true) {
      console.log(`Skipping unsubscribed user: ${data.email}`);
      return;
    }

    const user = {
      id: doc.id,
      email: data.email,
      name: data.displayName || data.name || '',
      firstName: data.displayName?.split(' ')[0] || data.name?.split(' ')[0] || '',
      orderCount: data.orderCount || 0,
      totalSpent: data.totalSpent || 0,
      lastOrderAt: data.lastOrderAt?.toDate?.() || data.lastOrderAt,
      createdAt: data.createdAt?.toDate?.() || data.createdAt,
    };

    // Apply cohort filter
    switch (cohort) {
      case 'vip':
        // VIP: $50+ spent AND 3+ orders
        if (user.totalSpent >= 5000 && user.orderCount >= 3) {
          users.push(user);
        }
        break;

      case 'loyal':
        // Loyal: 5+ orders
        if (user.orderCount >= 5) {
          users.push(user);
        }
        break;

      case 'active':
        // Active: ordered in last 30 days
        if (user.lastOrderAt && new Date(user.lastOrderAt) > thirtyDaysAgo) {
          users.push(user);
        }
        break;

      case 'at-risk':
        // At Risk: no order in 30+ days but has ordered before
        if (user.orderCount > 0 && (!user.lastOrderAt || new Date(user.lastOrderAt) < thirtyDaysAgo)) {
          users.push(user);
        }
        break;

      case 'churned':
        // Churned: no order in 60+ days
        if (user.orderCount > 0 && (!user.lastOrderAt || new Date(user.lastOrderAt) < sixtyDaysAgo)) {
          users.push(user);
        }
        break;

      case 'one-time':
        // One-time: exactly 1 order
        if (user.orderCount === 1) {
          users.push(user);
        }
        break;

      case 'new':
        // New: signed up in last 7 days
        if (user.createdAt && new Date(user.createdAt) > sevenDaysAgo) {
          users.push(user);
        }
        break;

      case 'never-ordered':
        // Never ordered but registered
        if (user.orderCount === 0) {
          users.push(user);
        }
        break;

      case 'all':
      default:
        users.push(user);
        break;
    }
  });

  return users;
}

async function updateCampaign(req, res) {
  const { id, ...updates } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const docRef = db.collection('email-campaigns').doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // Build allowed updates
  const allowedUpdates = {};

  if (updates.name !== undefined) allowedUpdates.name = updates.name.trim();
  if (updates.subject !== undefined) allowedUpdates.subject = updates.subject.trim();
  if (updates.variables !== undefined) allowedUpdates.variables = updates.variables;
  if (updates.cohort !== undefined) allowedUpdates.cohort = updates.cohort;
  if (updates.status !== undefined) allowedUpdates.status = updates.status;

  await docRef.update(allowedUpdates);

  return res.status(200).json({ id, ...allowedUpdates });
}

async function deleteCampaign(req, res) {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const docRef = db.collection('email-campaigns').doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  await docRef.delete();

  return res.status(200).json({ success: true });
}
