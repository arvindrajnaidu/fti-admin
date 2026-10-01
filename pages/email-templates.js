import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { withAuth } from '../lib/withAuth';
import { Envelope } from '@phosphor-icons/react';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/layout/Modal';

// Default email templates to seed
const DEFAULT_TEMPLATES = [
  {
    name: 'Seasonal Occasion Announcement',
    slug: 'seasonal-announcement',
    category: 'seasonal',
    subject: '{{OCCASION}} is {{WEEKS}} weeks away - send love from abroad',
    previewText: 'Send {{FOOD_TYPE}} to your loved ones in India',
    description: 'Main template for seasonal campaigns (Valentine\'s, Holi, Diwali, etc.)',
    variables: ['FIRST_NAME', 'OCCASION', 'WEEKS', 'DATE', 'FOOD_TYPE', 'VENDOR_TYPE', 'ACTION_VERB', 'PROMO_CODE', 'CTA_URL'],
    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px 0; }
    .logo { font-size: 24px; font-weight: bold; color: #117150; }
    .hero { background: linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%); padding: 40px; border-radius: 12px; text-align: center; margin: 20px 0; }
    .hero h1 { font-size: 28px; color: #333; margin: 0 0 10px 0; }
    .hero p { font-size: 16px; color: #666; margin: 0; }
    .cta-button { display: inline-block; background: #117150; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }
    .promo-box { background: #f5f5f5; border: 2px dashed #117150; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .promo-code { font-size: 24px; font-weight: bold; color: #117150; letter-spacing: 2px; }
    .features { margin: 20px 0; }
    .feature { display: inline-block; width: 30%; padding: 15px; text-align: center; vertical-align: top; }
    .feature-icon { font-size: 24px; margin-bottom: 8px; }
    .footer { text-align: center; padding: 30px 0; color: #999; font-size: 12px; border-top: 1px solid #eee; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">FoodtoIndia</div>
    </div>

    <div class="hero">
      <h1>{{OCCASION}} is {{WEEKS}} weeks away</h1>
      <p>Send {{FOOD_TYPE}} to your loved ones in India</p>
    </div>

    <p>Hi {{FIRST_NAME}},</p>

    <p>{{OCCASION}} is coming up on {{DATE}}.</p>

    <p>Even though you're thousands of miles away, you can still {{ACTION_VERB}} together. Send {{FOOD_TYPE}} from local {{VENDOR_TYPE}} in India—fresh, not pre-packaged gift boxes.</p>

    <div style="text-align: center;">
      <a href="{{CTA_URL}}" class="cta-button">Send {{OCCASION}} Gift</a>
    </div>

    <div class="promo-box">
      <p style="margin: 0 0 10px 0;">Use code for $5 off:</p>
      <div class="promo-code">{{PROMO_CODE}}</div>
    </div>

    <div class="features">
      <div class="feature">
        <div class="feature-icon">🌍</div>
        <strong>190+ Countries</strong>
        <p style="font-size: 12px; margin: 5px 0 0 0;">Order from anywhere</p>
      </div>
      <div class="feature">
        <div class="feature-icon">💳</div>
        <strong>Pay in USD</strong>
        <p style="font-size: 12px; margin: 5px 0 0 0;">No UPI needed</p>
      </div>
      <div class="feature">
        <div class="feature-icon">📱</div>
        <strong>No App Needed</strong>
        <p style="font-size: 12px; margin: 5px 0 0 0;">Recipients just receive</p>
      </div>
    </div>

    <p>Same-day delivery in 500+ cities. Track your order in real-time.</p>

    <p>With love,<br>The FoodtoIndia Team</p>

    <div class="footer">
      <p>Made with ❤️ in San Francisco</p>
      <p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a> | <a href="https://foodtoindia.com">Visit Website</a></p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    name: 'Last Chance / Urgency',
    slug: 'last-chance',
    category: 'seasonal',
    subject: '⏰ {{DAYS}} days left: {{OCCASION}} delivery',
    previewText: 'Order now for {{OCCASION}} delivery',
    description: 'Urgency template sent 2-3 days before occasion deadline',
    variables: ['FIRST_NAME', 'OCCASION', 'DAYS', 'FOOD_TYPE', 'RECIPIENT_TYPE', 'CTA_URL', 'PROMO_CODE'],
    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .urgent-banner { background: #ff6b6b; color: white; padding: 15px; text-align: center; border-radius: 8px; margin-bottom: 20px; }
    .urgent-banner h2 { margin: 0; font-size: 20px; }
    .countdown { text-align: center; margin: 30px 0; }
    .countdown-number { font-size: 48px; font-weight: bold; color: #117150; }
    .countdown-label { font-size: 14px; color: #666; text-transform: uppercase; }
    .cta-button { display: inline-block; background: #117150; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; }
    .footer { text-align: center; padding: 30px 0; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="urgent-banner">
      <h2>⏰ Last Chance: {{OCCASION}} Delivery</h2>
    </div>

    <p>Hi {{FIRST_NAME}},</p>

    <p><strong>{{OCCASION}} is in {{DAYS}} days.</strong></p>

    <p>If you want {{FOOD_TYPE}} delivered to your {{RECIPIENT_TYPE}} in time, order today.</p>

    <div class="countdown">
      <div class="countdown-number">{{DAYS}}</div>
      <div class="countdown-label">Days Left</div>
    </div>

    <div style="text-align: center;">
      <a href="{{CTA_URL}}?code={{PROMO_CODE}}" class="cta-button">Order Now - $5 Off</a>
    </div>

    <p style="margin-top: 30px;">Most orders deliver within 30-60 minutes once placed. But during {{OCCASION}}, demand is high—don't wait until the last minute.</p>

    <p>- The FoodtoIndia Team</p>

    <div class="footer">
      <p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    name: 'Win-back: We Miss You',
    slug: 'winback-miss-you',
    category: 're-engagement',
    subject: 'We miss you, {{FIRST_NAME}}. Your family misses you too.',
    previewText: 'It\'s been {{DAYS_SINCE}} days since your last order',
    description: 'Re-engagement email for churned customers (60+ days inactive)',
    variables: ['FIRST_NAME', 'DAYS_SINCE_LAST_ORDER', 'LAST_ORDER_ITEMS', 'LAST_RECIPIENT_NAME', 'LAST_RECIPIENT_CITY', 'LAST_ORDER_DATE', 'CTA_URL', 'PROMO_CODE', 'DISCOUNT_AMOUNT'],
    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; }
    .logo { font-size: 24px; font-weight: bold; color: #117150; }
    .memory-box { background: #fffaf3; border-radius: 12px; padding: 25px; margin: 20px 0; }
    .memory-box h3 { margin: 0 0 15px 0; color: #117150; }
    .last-order { background: white; padding: 15px; border-radius: 8px; border: 1px solid #e0e3e8; }
    .incentive-banner { background: linear-gradient(135deg, #117150 0%, #0d5a3e 100%); color: white; padding: 30px; border-radius: 12px; text-align: center; margin: 25px 0; }
    .incentive-amount { font-size: 48px; font-weight: bold; }
    .cta-button { display: inline-block; background: white; color: #117150; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 15px; }
    .footer { text-align: center; padding: 30px 0; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">FoodtoIndia</div>
    </div>

    <p>Hi {{FIRST_NAME}},</p>

    <p>It's been {{DAYS_SINCE_LAST_ORDER}} days since you last sent food to someone you love in India.</p>

    <p>We still remember...</p>

    <div class="memory-box">
      <h3>Your Last Order</h3>
      <div class="last-order">
        <p style="margin: 0;"><strong>{{LAST_ORDER_ITEMS}}</strong></p>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">
          Sent to {{LAST_RECIPIENT_NAME}} in {{LAST_RECIPIENT_CITY}}<br>
          {{LAST_ORDER_DATE}}
        </p>
      </div>
    </div>

    <p>Maybe it's time to surprise them again? No special occasion needed—just because.</p>

    <div class="incentive-banner">
      <p style="margin: 0 0 10px 0; opacity: 0.9;">Welcome back offer:</p>
      <div class="incentive-amount">{{DISCOUNT_AMOUNT}} OFF</div>
      <p style="margin: 5px 0 0 0;">Your next order</p>
      <a href="{{CTA_URL}}?code={{PROMO_CODE}}" class="cta-button">Send Food Now</a>
      <p style="margin: 15px 0 0 0; font-size: 12px; opacity: 0.8;">Code: {{PROMO_CODE}} • Expires in 7 days</p>
    </div>

    <p>Same restaurants. Same love. We've just gotten better at delivering it.</p>

    <p>- The FoodtoIndia Team</p>

    <div class="footer">
      <p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    name: 'Never Ordered: How It Works',
    slug: 'never-ordered-how-it-works',
    category: 're-engagement',
    subject: 'Here\'s what you\'re missing, {{FIRST_NAME}}',
    previewText: 'Send food to India in 3 simple steps',
    description: 'Education email for users who registered but never ordered',
    variables: ['FIRST_NAME', 'DAYS_SINCE_SIGNUP', 'CTA_URL', 'PROMO_CODE'],
    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; }
    .logo { font-size: 24px; font-weight: bold; color: #117150; }
    .steps { margin: 30px 0; }
    .step { margin-bottom: 20px; padding-left: 50px; position: relative; }
    .step-number { position: absolute; left: 0; top: 0; background: #117150; color: white; width: 32px; height: 32px; border-radius: 50%; text-align: center; line-height: 32px; font-weight: bold; }
    .step h4 { margin: 0 0 5px 0; }
    .step p { margin: 0; color: #666; font-size: 14px; }
    .objection-box { background: #f0f0f0; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .objection-box h4 { margin: 0 0 10px 0; }
    .objection-box p { margin: 0; }
    .cta-button { display: inline-block; background: #117150; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; }
    .footer { text-align: center; padding: 30px 0; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">FoodtoIndia</div>
    </div>

    <p>Hi {{FIRST_NAME}},</p>

    <p>You created an account {{DAYS_SINCE_SIGNUP}} days ago but haven't placed your first order yet.</p>

    <p>Maybe you're wondering how it works? Here's the 60-second version:</p>

    <div class="steps">
      <div class="step">
        <div class="step-number">1</div>
        <h4>Enter any address in India</h4>
        <p>Home, office, or anywhere—we cover 500+ cities</p>
      </div>
      <div class="step">
        <div class="step-number">2</div>
        <h4>Browse local restaurants</h4>
        <p>Same places on Swiggy & Zomato—biryani, cakes, sweets</p>
      </div>
      <div class="step">
        <div class="step-number">3</div>
        <h4>Pay in USD & track delivery</h4>
        <p>We handle everything. They just receive the surprise.</p>
      </div>
    </div>

    <div class="objection-box">
      <h4>🤔 "Does my family need an app?"</h4>
      <p><strong>Nope!</strong> They don't need to download anything, enter OTPs, or be tech-savvy. Food just shows up at their door.</p>
    </div>

    <p>Ready to make someone's day?</p>

    <div style="text-align: center; margin: 25px 0;">
      <a href="{{CTA_URL}}?code={{PROMO_CODE}}" class="cta-button">Get $5 Off Your First Order</a>
      <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">Code: {{PROMO_CODE}}</p>
    </div>

    <p>- The FoodtoIndia Team</p>

    <div class="footer">
      <p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    name: 'Post-Delivery Success',
    slug: 'post-delivery-success',
    category: 'transactional',
    subject: '🎉 {{RECIPIENT_NAME}} received the {{FOOD_TYPE}}!',
    previewText: 'Your gift was delivered successfully',
    description: 'Sent after successful delivery to encourage sharing and referrals',
    variables: ['FIRST_NAME', 'RECIPIENT_NAME', 'FOOD_TYPE', 'CITY', 'USER_REFERRAL_CODE', 'PHOTO_UPLOAD_URL', 'REVIEW_URL', 'WHATSAPP_SHARE_URL'],
    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .success-banner { background: linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%); padding: 30px; text-align: center; border-radius: 12px; margin-bottom: 20px; }
    .success-icon { font-size: 48px; }
    .action-cards { margin: 20px 0; }
    .action-card { background: #f9f9f9; padding: 20px; border-radius: 8px; border-left: 4px solid #117150; margin-bottom: 15px; }
    .action-card h3 { margin: 0 0 8px 0; font-size: 16px; }
    .action-card p { margin: 0; font-size: 14px; color: #666; }
    .action-card a { color: #117150; }
    .referral-box { background: #117150; color: white; padding: 25px; border-radius: 12px; text-align: center; margin: 20px 0; }
    .referral-code { background: white; color: #117150; padding: 10px 20px; border-radius: 6px; font-weight: bold; font-size: 18px; display: inline-block; margin-top: 10px; }
    .footer { text-align: center; padding: 30px 0; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-banner">
      <div class="success-icon">🎉</div>
      <h1 style="margin: 10px 0 5px 0;">Delivered!</h1>
      <p style="margin: 0; color: #666;">{{RECIPIENT_NAME}} received your gift</p>
    </div>

    <p>Hi {{FIRST_NAME}},</p>

    <p>Great news! Your order was delivered to <strong>{{RECIPIENT_NAME}}</strong> in <strong>{{CITY}}</strong>.</p>

    <p>We hope it brought a smile to their face. 😊</p>

    <div class="action-cards">
      <div class="action-card">
        <h3>📸 Share the Moment</h3>
        <p>Ask {{RECIPIENT_NAME}} to send you a photo! Share it with us for $5 credit on your next order.</p>
        <a href="{{PHOTO_UPLOAD_URL}}">Upload Photo →</a>
      </div>

      <div class="action-card">
        <h3>⭐ Leave a Review</h3>
        <p>How was your experience? Your feedback helps us improve.</p>
        <a href="{{REVIEW_URL}}">Write Review →</a>
      </div>
    </div>

    <div class="referral-box">
      <h3 style="margin: 0 0 10px 0;">Give $5, Get $5</h3>
      <p style="margin: 0; opacity: 0.9;">Share FoodtoIndia with friends. They get $5 off, you get $5 credit.</p>
      <div class="referral-code">{{USER_REFERRAL_CODE}}</div>
      <p style="margin: 10px 0 0 0; font-size: 12px;">
        <a href="{{WHATSAPP_SHARE_URL}}" style="color: white;">Share on WhatsApp</a>
      </p>
    </div>

    <p>Thank you for choosing FoodtoIndia. We can't wait to help you send more love!</p>

    <p>- The FoodtoIndia Team</p>

    <div class="footer">
      <p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    name: 'Valentine\'s Day',
    slug: 'valentines-day',
    category: 'seasonal',
    subject: 'Long distance love, delivered 💕',
    previewText: 'Send romantic cakes & dinners to your partner in India',
    description: 'Valentine\'s Day specific campaign template',
    variables: ['FIRST_NAME', 'CTA_URL', 'PROMO_CODE'],
    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; }
    .logo { font-size: 24px; font-weight: bold; color: #117150; }
    .hero { background: linear-gradient(135deg, #FCE4EC 0%, #F8BBD9 100%); padding: 40px; border-radius: 12px; text-align: center; margin: 20px 0; }
    .hero h1 { font-size: 32px; color: #333; margin: 0 0 10px 0; }
    .hero p { font-size: 16px; color: #666; margin: 0; }
    .heart { font-size: 48px; margin-bottom: 15px; }
    .products { margin: 30px 0; text-align: center; }
    .product-item { display: inline-block; margin: 10px; padding: 15px 25px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .cta-button { display: inline-block; background: #E91E63; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }
    .promo-box { background: #FCE4EC; border: 2px dashed #E91E63; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .promo-code { font-size: 24px; font-weight: bold; color: #E91E63; letter-spacing: 2px; }
    .footer { text-align: center; padding: 30px 0; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">FoodtoIndia</div>
    </div>

    <div class="hero">
      <div class="heart">💕</div>
      <h1>Long Distance Love, Delivered</h1>
      <p>You may be 8,000 miles apart, but you can still share dinner together.</p>
    </div>

    <p>Hi {{FIRST_NAME}},</p>

    <p>Valentine's Day is coming up, and distance shouldn't stop you from celebrating with your special someone in India.</p>

    <div class="products">
      <div class="product-item">🎂 Heart-Shaped Cakes</div>
      <div class="product-item">🍫 Chocolate Truffles</div>
      <div class="product-item">🍽️ Romantic Dinner</div>
      <div class="product-item">🌹 Rose-themed Desserts</div>
    </div>

    <p>Send your partner a romantic meal or cake—delivered right to their door. Schedule it for February 14th and surprise them.</p>

    <div style="text-align: center;">
      <a href="{{CTA_URL}}" class="cta-button">Send Valentine's Gift</a>
    </div>

    <div class="promo-box">
      <p style="margin: 0 0 10px 0;">$5 off your Valentine's order:</p>
      <div class="promo-code">{{PROMO_CODE}}</div>
    </div>

    <p>With love,<br>The FoodtoIndia Team</p>

    <div class="footer">
      <p>Made with ❤️ in San Francisco</p>
      <p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`,
  },
];

const CATEGORIES = [
  { value: 'seasonal', label: 'Seasonal Campaigns' },
  { value: 're-engagement', label: 'Re-engagement' },
  { value: 'transactional', label: 'Transactional' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'general', label: 'General' },
];

const AUDIENCES = [
  { value: '', label: 'All Customers' },
  { value: 'vip', label: 'VIP ($50+ & 3+ orders)' },
  { value: 'loyal', label: 'Loyal (5+ orders)' },
  { value: 'active', label: 'Active (last 30 days)' },
  { value: 'at-risk', label: 'At Risk (inactive 30+ days)' },
  { value: 'one-time', label: 'One-time Customers' },
  { value: 'new', label: 'New (last 7 days)' },
  { value: 'abandoned', label: 'Abandoned Accounts' },
];

export default function EmailTemplatesPage() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
      setLoggingOut(false);
    }
  };

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);

  // Create/Edit form state
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    category: 'general',
    audience: '',
    subject: '',
    previewText: '',
    description: '',
    htmlContent: '',
    variables: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // Preview state
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [previewVariables, setPreviewVariables] = useState({});

  useEffect(() => {
    fetchTemplates();
    fetchEnvironment();
  }, []);

  const fetchEnvironment = async () => {
    try {
      const response = await fetch('/api/environment');
      if (response.ok) {
        const data = await response.json();
        setEnvironment(data.environment);
      }
    } catch (err) {
      console.error('Failed to fetch environment:', err);
    }
  };

  const fetchTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/email-templates');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to fetch templates');
      }

      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchTemplates();
    } finally {
      setRefreshing(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      slug: '',
      category: 'general',
      audience: '',
      subject: '',
      previewText: '',
      description: '',
      htmlContent: '',
      variables: '',
    });
    setEditingTemplate(null);
    setShowForm(false);
    setFormError(null);
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      slug: template.slug,
      category: template.category,
      audience: template.audience || '',
      subject: template.subject,
      previewText: template.previewText || '',
      description: template.description || '',
      htmlContent: template.htmlContent,
      variables: (template.variables || []).join(', '),
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const isEditing = editingTemplate !== null;

    try {
      const variablesArray = formData.variables
        .split(',')
        .map(v => v.trim().toUpperCase())
        .filter(v => v.length > 0);

      const payload = {
        name: formData.name,
        slug: formData.slug,
        category: formData.category,
        audience: formData.audience,
        subject: formData.subject,
        previewText: formData.previewText,
        description: formData.description,
        htmlContent: formData.htmlContent,
        variables: variablesArray,
      };

      if (isEditing) {
        payload.id = editingTemplate.id;
      }

      const response = await fetch('/api/email-templates', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to ${isEditing ? 'update' : 'create'} template`);
      }

      resetForm();
      await fetchTemplates();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (template) => {
    try {
      const response = await fetch('/api/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: template.id,
          isActive: !template.isActive,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update template');
      }

      await fetchTemplates();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (template) => {
    if (!confirm(`Are you sure you want to delete template "${template.name}"?`)) {
      return;
    }

    try {
      const response = await fetch('/api/email-templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: template.id }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete template');
      }

      await fetchTemplates();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDuplicate = (template) => {
    setEditingTemplate(null);
    setFormData({
      name: `${template.name} (Copy)`,
      slug: `${template.slug}-copy`,
      category: template.category,
      audience: template.audience || '',
      subject: template.subject,
      previewText: template.previewText || '',
      description: template.description || '',
      htmlContent: template.htmlContent,
      variables: (template.variables || []).join(', '),
    });
    setShowForm(true);
    setFormError(null);
  };

  const handlePreview = (template) => {
    setPreviewTemplate(template);
    // Initialize preview variables with placeholder values
    const vars = {};
    (template.variables || []).forEach(v => {
      vars[v] = `[${v}]`;
    });
    setPreviewVariables(vars);
  };

  const handleSeedDefaults = async () => {
    if (!confirm('This will create default email templates. Existing templates with the same slug will be skipped. Continue?')) {
      return;
    }

    setSubmitting(true);
    let created = 0;
    let skipped = 0;

    for (const template of DEFAULT_TEMPLATES) {
      try {
        const response = await fetch('/api/email-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(template),
        });

        if (response.ok) {
          created++;
        } else {
          skipped++;
        }
      } catch (err) {
        skipped++;
      }
    }

    setSubmitting(false);
    alert(`Created ${created} templates, skipped ${skipped} (already exist)`);
    await fetchTemplates();
  };

  const getRenderedHtml = () => {
    if (!previewTemplate) return '';
    let html = previewTemplate.htmlContent;
    Object.entries(previewVariables).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      html = html.replace(regex, value);
    });
    return html;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getCategoryLabel = (value) => {
    const cat = CATEGORIES.find(c => c.value === value);
    return cat ? cat.label : value;
  };

  const getCategoryColor = (category) => {
    const colors = {
      seasonal: { bg: '#fbf0dc', color: '#a05a00' },
      're-engagement': { bg: '#eceafb', color: '#3f3ccc' },
      transactional: { bg: '#e6f4ec', color: '#0f7a52' },
      onboarding: { bg: '#eceafb', color: '#3f3ccc' },
      general: { bg: '#eef0f3', color: '#444b57' },
    };
    return colors[category] || colors.general;
  };

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin - Email Templates</title>
      </Head>

      <PageHeader
        icon={Envelope}
        title="Email Templates"
        subtitle={`${templates.length} ${templates.length === 1 ? 'template' : 'templates'}`}
      />

      {/* Action Buttons */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <button
          onClick={() => {
            if (showForm) {
              resetForm();
            } else {
              setEditingTemplate(null);
              setShowForm(true);
            }
          }}
          style={{
            padding: '10px 20px',
            fontSize: '14px',
            backgroundColor: showForm ? '#636a78' : '#0f7a52',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : '+ Create New Template'}
        </button>
        {templates.length === 0 && (
          <button
            onClick={handleSeedDefaults}
            disabled={submitting}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              backgroundColor: '#3f3ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Creating...' : '📋 Seed Default Templates'}
          </button>
        )}
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div style={{
          backgroundColor: editingTemplate ? '#fbf0dc' : '#f7f8f9',
          border: `1px solid ${editingTemplate ? '#a05a00' : '#e0e3e8'}`,
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
        }}>
          <h3 style={{ marginTop: 0 }}>
            {editingTemplate ? `Edit Template: ${editingTemplate.name}` : 'Create New Template'}
          </h3>
          {formError && (
            <div style={{
              backgroundColor: '#fbe8e6',
              border: '1px solid #fbe8e6',
              borderRadius: '4px',
              padding: '10px',
              marginBottom: '15px',
              color: '#b42318',
            }}>
              {formError}
            </div>
          )}
          <form onSubmit={handleFormSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Template Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Valentine's Day Campaign"
                  required
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Slug *
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                  placeholder="e.g., valentines-day"
                  required
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Category *
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  style={inputStyle}
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Target Audience
                </label>
                <select
                  value={formData.audience}
                  onChange={(e) => setFormData({ ...formData, audience: e.target.value })}
                  style={inputStyle}
                >
                  {AUDIENCES.map(aud => (
                    <option key={aud.value} value={aud.value}>{aud.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Variables (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.variables}
                  onChange={(e) => setFormData({ ...formData, variables: e.target.value })}
                  placeholder="e.g., FIRST_NAME, OCCASION, PROMO_CODE"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginTop: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Subject Line * <span style={{ fontWeight: 'normal', color: '#636a78' }}>(use {'{{VARIABLE}}'} for placeholders)</span>
              </label>
              <input
                type="text"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder="e.g., {{OCCASION}} is {{WEEKS}} weeks away - send love from abroad"
                required
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>

            <div style={{ marginTop: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Preview Text
              </label>
              <input
                type="text"
                value={formData.previewText}
                onChange={(e) => setFormData({ ...formData, previewText: e.target.value })}
                placeholder="Short preview text shown in inbox"
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>

            <div style={{ marginTop: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Internal description of when to use this template"
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>

            <div style={{ marginTop: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                HTML Content *
              </label>
              <textarea
                value={formData.htmlContent}
                onChange={(e) => setFormData({ ...formData, htmlContent: e.target.value })}
                placeholder="Paste your HTML email template here..."
                required
                rows={15}
                style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>

            <div style={{ marginTop: '20px' }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '10px 30px',
                  fontSize: '14px',
                  backgroundColor: submitting ? '#636a78' : (editingTemplate ? '#a05a00' : '#3f3ccc'),
                  color: editingTemplate ? '#000' : 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting
                  ? (editingTemplate ? 'Updating...' : 'Creating...')
                  : (editingTemplate ? 'Update Template' : 'Create Template')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading/Error States */}
      {loading && <div style={{ textAlign: 'center', padding: '40px' }}>Loading templates...</div>}
      {error && (
        <div style={{
          backgroundColor: '#fbf0dc',
          border: '1px solid #a05a00',
          borderRadius: '8px',
          padding: '20px',
          margin: '20px 0',
        }}>
          <h3 style={{ color: '#a05a00', marginTop: 0 }}>Error Loading Templates</h3>
          <div style={{ color: '#a05a00' }}>{error}</div>
        </div>
      )}

      {/* Templates Table */}
      {!loading && !error && templates.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#636a78' }}>
          No email templates found. Create one or seed default templates to get started!
        </div>
      )}

      {!loading && !error && templates.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #ddd',
            backgroundColor: 'white',
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f7f8f9' }}>
                <th style={headerStyle}>Name</th>
                <th style={headerStyle}>Slug</th>
                <th style={headerStyle}>Category</th>
                <th style={headerStyle}>Audience</th>
                <th style={headerStyle}>Subject</th>
                <th style={headerStyle}>Variables</th>
                <th style={headerStyle}>Status</th>
                <th style={headerStyle}>Updated</th>
                <th style={headerStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const catColor = getCategoryColor(template.category);
                return (
                  <tr key={template.id} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={cellStyle}>
                      <strong>{template.name}</strong>
                      {template.description && (
                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#636a78' }}>
                          {template.description}
                        </p>
                      )}
                    </td>
                    <td style={cellStyle}>
                      <code style={{ fontSize: '12px', backgroundColor: '#f0f0f0', padding: '2px 6px', borderRadius: '3px' }}>
                        {template.slug}
                      </code>
                    </td>
                    <td style={cellStyle}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: catColor.bg,
                        color: catColor.color,
                      }}>
                        {getCategoryLabel(template.category)}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      {template.audience ? (
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: '#e7f3ff',
                          color: '#0066cc',
                        }}>
                          {AUDIENCES.find(a => a.value === template.audience)?.label || template.audience}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#8c93a0' }}>All Users</span>
                      )}
                    </td>
                    <td style={{ ...cellStyle, maxWidth: '200px' }}>
                      <span style={{ fontSize: '13px' }} title={template.subject}>
                        {template.subject.length > 50 ? template.subject.substring(0, 50) + '...' : template.subject}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span style={{ fontSize: '12px', color: '#636a78' }}>
                        {(template.variables || []).length} vars
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: template.isActive ? '#e6f4ec' : '#fbe8e6',
                        color: template.isActive ? '#0f7a52' : '#b42318',
                      }}>
                        {template.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={cellStyle}>{formatDate(template.updatedAt)}</td>
                    <td style={cellStyle}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handlePreview(template)}
                          style={{ ...actionButtonStyle, backgroundColor: '#3f3ccc' }}
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => handleEdit(template)}
                          style={{ ...actionButtonStyle, backgroundColor: '#3f3ccc' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDuplicate(template)}
                          style={{ ...actionButtonStyle, backgroundColor: '#636a78' }}
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => handleToggleActive(template)}
                          style={{
                            ...actionButtonStyle,
                            backgroundColor: template.isActive ? '#a05a00' : '#0f7a52',
                            color: template.isActive ? '#000' : '#fff',
                          }}
                        >
                          {template.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => handleDelete(template)}
                          style={{ ...actionButtonStyle, backgroundColor: '#b42318' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview Modal */}
      <Modal
        open={!!previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        title={previewTemplate ? `Preview: ${previewTemplate.name}` : ''}
        maxWidth="max-w-[1000px]"
      >
        {previewTemplate ? (
          <>
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Variables Panel */}
              <div style={{ width: '300px', padding: '20px', borderRight: '1px solid #ddd', overflowY: 'auto' }}>
                <h4 style={{ marginTop: 0 }}>Test Variables</h4>
                <p style={{ fontSize: '12px', color: '#636a78' }}>
                  Edit values below to preview the email with sample data.
                </p>
                {(previewTemplate.variables || []).map((variable) => (
                  <div key={variable} style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '3px' }}>
                      {variable}
                    </label>
                    <input
                      type="text"
                      value={previewVariables[variable] || ''}
                      onChange={(e) => setPreviewVariables({ ...previewVariables, [variable]: e.target.value })}
                      style={{ ...inputStyle, width: '100%', fontSize: '12px', padding: '6px' }}
                    />
                  </div>
                ))}
              </div>
              {/* Preview Panel */}
              <div style={{ flex: 1, padding: '20px', overflowY: 'auto', backgroundColor: '#f5f5f5' }}>
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'white', borderRadius: '4px' }}>
                  <strong>Subject:</strong> {previewTemplate.subject.replace(/\{\{(\w+)\}\}/g, (_, key) => previewVariables[key] || `[${key}]`)}
                </div>
                <div style={{ backgroundColor: 'white', borderRadius: '4px', overflow: 'hidden' }}>
                  <iframe
                    srcDoc={getRenderedHtml()}
                    style={{ width: '100%', height: '500px', border: 'none' }}
                    title="Email Preview"
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </AdminShell>
  );
}

const headerStyle = {
  padding: '12px 8px',
  textAlign: 'left',
  fontWeight: 'bold',
  fontSize: '14px',
  borderBottom: '2px solid #ddd',
};

const cellStyle = {
  padding: '12px 8px',
  fontSize: '14px',
  verticalAlign: 'top',
};

const inputStyle = {
  padding: '10px',
  fontSize: '14px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  boxSizing: 'border-box',
};

const actionButtonStyle = {
  padding: '5px 10px',
  fontSize: '11px',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

export const getServerSideProps = withAuth();
