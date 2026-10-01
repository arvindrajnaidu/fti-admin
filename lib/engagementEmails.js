// Shared email template builders for the customer-engagement campaigns
// (re-engagement / win-back, and feedback request). Used by both the send
// endpoint and the preview endpoint so the rendered HTML is identical.

export const VALID_CAMPAIGN_TYPES = ['winback', 'feedback'];

export function buildEngagementEmail({ campaignType, name, email }) {
  if (campaignType === 'winback') return buildWinBackEmail({ name, email });
  if (campaignType === 'feedback') return buildFeedbackEmail({ name, email });
  throw new Error(`Unknown campaignType: ${campaignType}`);
}

function emailShell({ email, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Sanchez:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #faf1e5; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 440px; margin: 0 auto; padding: 20px;">
    <div style="background: #fff; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.07); overflow: hidden;">
      <div style="padding: 16px 20px; text-align: center; border-bottom: 3px solid #117150;">
        <div style="font-family: 'Sanchez', serif; font-size: 18px; font-weight: 700; color: #117150;">FoodtoIndia</div>
      </div>
      <div style="padding: 24px;">
        ${bodyHtml}
      </div>
      <div style="padding: 20px; text-align: center; font-size: 12px; color: #aaa; border-top: 1px solid #f0f0f0;">
        Follow us on Instagram: <a href="https://www.instagram.com/food2india" style="color: #667085; text-decoration: none; font-weight: 500;">@food2india</a><br>
        <a href="https://www.foodtoindia.com" style="color: #667085; text-decoration: none;">foodtoindia.com</a><br>
        <a href="https://www.foodtoindia.com/unsubscribe?email=${encodeURIComponent(email)}" style="color: #aaa; text-decoration: underline; font-size: 11px;">Unsubscribe</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildWinBackEmail({ name, email }) {
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const subject = name ? `We've missed you, ${name}` : `We've missed you`;

  const bodyHtml = `
    <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 12px 0; color: #2D2A26;">${greeting}</h2>
    <p style="font-size: 14px; line-height: 1.65; color: #444; margin: 0 0 16px 0;">
      It's been a little while since we last sent food to your loved ones, and we just wanted to check in. We hope you and yours have been doing well.
    </p>
    <p style="font-size: 14px; line-height: 1.65; color: #444; margin: 0 0 16px 0;">
      If something didn't quite work the last time (a delivery hiccup, a dish that didn't land, anything at all), we'd genuinely love to hear about it. Just reply to this email and someone from our team will get back to you personally.
    </p>
    <p style="font-size: 14px; line-height: 1.65; color: #444; margin: 0 0 8px 0;">
      And whenever you're ready, sending a meal back home is just a few taps away.
    </p>
    <div style="text-align: center; margin: 28px 0 12px;">
      <a href="https://www.foodtoindia.com" style="display: inline-block; padding: 14px 40px; background-color: #117150; color: #ffffff; text-decoration: none; border-radius: 9999px; font-weight: 700; font-size: 15px; letter-spacing: 0.01em;">
        Send Food to India
      </a>
    </div>
    <p style="font-size: 13px; color: #8A8279; line-height: 1.5; margin: 16px 0 0; text-align: center;">
      Same-day delivery in 500+ cities &bull; Pay in USD &bull; Payments secured by Stripe
    </p>
  `;

  return { subject, html: emailShell({ email, bodyHtml }) };
}

function buildFeedbackEmail({ name, email }) {
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const subject = name
    ? `How was your FoodtoIndia order, ${name}?`
    : `How was your FoodtoIndia order?`;

  const bodyHtml = `
    <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 12px 0; color: #2D2A26;">${greeting}</h2>
    <p style="font-size: 14px; line-height: 1.65; color: #444; margin: 0 0 16px 0;">
      Thanks so much for trying FoodtoIndia recently. We're a small team and every customer matters to us, which is why we'd love your honest take.
    </p>
    <p style="font-size: 14px; line-height: 1.65; color: #444; margin: 0 0 8px 0;">
      Was the food delivered on time? Did your loved ones enjoy what arrived? Was anything not quite right? Even a one-line reply would mean a lot. We read every response.
    </p>
    <div style="text-align: center; margin: 28px 0 8px;">
      <a href="https://www.foodtoindia.com" style="color: #117150; text-decoration: none; font-weight: 600; font-size: 14px;">
        Or, if you're ready, send another meal &rarr;
      </a>
    </div>
  `;

  return { subject, html: emailShell({ email, bodyHtml }) };
}
