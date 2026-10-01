# Ready-to-Use Email Templates for SendGrid

Copy these HTML templates directly into SendGrid Dynamic Templates.

**How to use:**
1. Go to SendGrid Dashboard → Email API → Dynamic Templates
2. Click "Create Template"
3. Add Version → Choose "Blank Template" → Code Editor
4. Copy-paste HTML below
5. Add test data and preview
6. Save and get Template ID

---

## Template 1: Day 1 Follow-Up Email

**Template Name:** `Day 1 Follow-Up - First Order`
**Subject:** `Did {{recipientName}} enjoy their meal? 🍽️`

**Test Data:**
```json
{
  "customerName": "John",
  "recipientName": "Mom",
  "restaurantName": "Paradise Biryani",
  "feedbackUrl": "https://foodtoindia.com/feedback?orderId=ABC123",
  "reorderUrl": "https://foodtoindia.com/reorder?orderId=ABC123",
  "unsubscribeUrl": "https://foodtoindia.com/unsubscribe?email=test@example.com"
}
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>How was the food?</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f5f5f5;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      text-align: center;
      padding: 40px 20px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .content {
      padding: 30px 40px;
    }
    .content p {
      line-height: 1.6;
      color: #333;
      margin: 0 0 15px;
    }
    .emoji-feedback {
      text-align: center;
      margin: 30px 0;
      padding: 20px;
      background-color: #f9f9f9;
      border-radius: 8px;
    }
    .emoji-feedback p {
      font-weight: 600;
      margin-bottom: 15px;
    }
    .emoji-link {
      font-size: 40px;
      text-decoration: none;
      margin: 0 15px;
      display: inline-block;
      transition: transform 0.2s;
    }
    .emoji-link:hover {
      transform: scale(1.2);
    }
    .discount-box {
      background: linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%);
      border-radius: 8px;
      padding: 25px;
      text-align: center;
      margin: 30px 0;
    }
    .discount-box p {
      margin: 0 0 10px;
      font-weight: 600;
      color: #2d3436;
    }
    .discount-code {
      background-color: white;
      color: #e17055;
      font-size: 24px;
      font-weight: bold;
      padding: 12px 30px;
      border-radius: 5px;
      display: inline-block;
      letter-spacing: 2px;
      margin: 10px 0;
      border: 2px dashed #e17055;
    }
    .cta-button {
      display: inline-block;
      padding: 14px 35px;
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
      color: white;
      text-decoration: none;
      border-radius: 25px;
      font-weight: 600;
      margin: 20px 0;
      transition: all 0.3s;
      box-shadow: 0 4px 15px rgba(238, 90, 111, 0.3);
    }
    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(238, 90, 111, 0.4);
    }
    .footer {
      background-color: #f9f9f9;
      padding: 30px 40px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .footer p {
      margin: 5px 0;
      font-size: 14px;
      color: #666;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 20px;
      }
      .discount-box {
        padding: 20px;
      }
      .emoji-link {
        font-size: 35px;
        margin: 0 10px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header -->
    <div class="header">
      <h1>🍽️ Food Delivered!</h1>
    </div>

    <!-- Content -->
    <div class="content">
      <p>Hi <strong>{{customerName}}</strong>,</p>

      <p>We hope <strong>{{recipientName}}</strong> enjoyed their delicious meal from <strong>{{restaurantName}}</strong>! 🎉</p>

      <!-- Feedback Section -->
      <div class="emoji-feedback">
        <p>Quick question: How did it go?</p>
        <div>
          <a href="{{feedbackUrl}}&rating=great" class="emoji-link" title="Great!">😊</a>
          <a href="{{feedbackUrl}}&rating=ok" class="emoji-link" title="It was OK">😐</a>
          <a href="{{feedbackUrl}}&rating=poor" class="emoji-link" title="Not great">😞</a>
        </div>
      </div>

      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

      <!-- Discount Section -->
      <div class="discount-box">
        <p style="font-size: 18px;">💝 Sending food again soon?</p>
        <p>Use this code for <strong>$2 off</strong> your next order:</p>
        <div class="discount-code">CAREFAM2</div>
      </div>

      <div style="text-align: center;">
        <a href="{{reorderUrl}}" class="cta-button">
          🔄 Send Same Order Again
        </a>
      </div>

      <p style="margin-top: 30px; font-size: 14px; color: #666; text-align: center;">
        Most of our customers send food 5-6 times to their loved ones!
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p><strong>- The FoodToIndia Team</strong></p>
      <p style="margin-top: 15px;">
        <a href="https://foodtoindia.com">Visit Website</a> •
        <a href="mailto:support@foodtoindia.com">Contact Support</a>
      </p>
      <p style="margin-top: 15px; font-size: 12px;">
        <a href="{{unsubscribeUrl}}">Unsubscribe from these emails</a>
      </p>
    </div>
  </div>
</body>
</html>
```

---

## Template 2: Day 7 Come Back Email

**Template Name:** `Day 7 Come Back - Win Back`
**Subject:** `Missing {{recipientName}}? Send them a treat 🎁`

**Test Data:**
```json
{
  "customerName": "John",
  "recipientName": "Mom",
  "recipientCity": "Mumbai",
  "popularRestaurants": ["Paradise Biryani", "Meghana Foods", "KFC"],
  "reorderUrl": "https://foodtoindia.com/reorder?orderId=ABC123&campaign=day7",
  "browseUrl": "https://foodtoindia.com/browse?city=Mumbai&campaign=day7",
  "unsubscribeUrl": "https://foodtoindia.com/unsubscribe?email=test@example.com"
}
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Come back!</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f5f5f5;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      text-align: center;
      padding: 40px 20px;
      background: linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%);
    }
    .header-emoji {
      font-size: 60px;
      margin-bottom: 10px;
    }
    .header h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 700;
      color: #2d3436;
    }
    .content {
      padding: 30px 40px;
    }
    .content p {
      line-height: 1.6;
      color: #333;
      margin: 0 0 15px;
    }
    .urgency-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px 20px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .urgency-box p {
      margin: 0;
      color: #856404;
      font-weight: 600;
    }
    .urgency-box .emoji {
      font-size: 20px;
      margin-right: 8px;
    }
    .discount-code {
      background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
      color: #155724;
      font-size: 28px;
      font-weight: bold;
      padding: 18px 35px;
      border-radius: 8px;
      display: inline-block;
      letter-spacing: 3px;
      margin: 20px 0;
      border: 3px dashed #28a745;
      text-align: center;
    }
    .restaurant-list {
      background-color: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      margin: 25px 0;
    }
    .restaurant-list ul {
      margin: 10px 0;
      padding-left: 25px;
    }
    .restaurant-list li {
      margin: 8px 0;
      color: #555;
    }
    .button-group {
      text-align: center;
      margin: 30px 0;
    }
    .cta-button {
      display: inline-block;
      padding: 14px 30px;
      color: white;
      text-decoration: none;
      border-radius: 25px;
      font-weight: 600;
      margin: 10px 5px;
      transition: all 0.3s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
      box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);
    }
    .btn-secondary {
      background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
      box-shadow: 0 4px 15px rgba(0, 123, 255, 0.3);
    }
    .cta-button:hover {
      transform: translateY(-2px);
    }
    .footer {
      background-color: #f9f9f9;
      padding: 30px 40px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .footer p {
      margin: 5px 0;
      font-size: 14px;
      color: #666;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 20px;
      }
      .header h1 {
        font-size: 26px;
      }
      .cta-button {
        display: block;
        margin: 10px 0;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header -->
    <div class="header">
      <div class="header-emoji">🎁</div>
      <h1>It's Been a Week!</h1>
    </div>

    <!-- Content -->
    <div class="content">
      <p>Hi <strong>{{customerName}}</strong>,</p>

      <p>It's been a week since you sent food to <strong>{{recipientName}}</strong> in <strong>{{recipientCity}}</strong>.</p>

      <p>We bet they'd love another surprise! 😊</p>

      <!-- Urgency Box -->
      <div class="urgency-box">
        <p>
          <span class="emoji">⏰</span>
          <strong>Special Offer:</strong> $3 off your next order (expires in 3 days!)
        </p>
      </div>

      <div style="text-align: center;">
        <div class="discount-code">COMEBACK3</div>
        <p style="font-size: 12px; color: #dc3545; font-weight: 600;">
          ⚠️ Expires in 3 days
        </p>
      </div>

      <!-- Restaurant List -->
      <div class="restaurant-list">
        <p style="margin: 0 0 10px; font-weight: 600; color: #333;">
          🍽️ Popular restaurants in {{recipientCity}}:
        </p>
        <ul>
          {{#each popularRestaurants}}
          <li>{{this}}</li>
          {{/each}}
        </ul>
      </div>

      <!-- CTA Buttons -->
      <div class="button-group">
        <a href="{{reorderUrl}}" class="cta-button btn-primary">
          🔄 Reorder Same Meal
        </a>
        <a href="{{browseUrl}}" class="cta-button btn-secondary">
          🔍 Browse Restaurants
        </a>
      </div>

      <p style="margin-top: 30px; font-size: 14px; color: #666; text-align: center; font-style: italic;">
        "I love how easy it is to send food to my parents. They look forward to it every week!" - Happy Customer
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p><strong>- The FoodToIndia Team</strong></p>
      <p style="margin-top: 15px;">
        <a href="https://foodtoindia.com">Visit Website</a> •
        <a href="mailto:support@foodtoindia.com">Contact Support</a>
      </p>
      <p style="margin-top: 15px; font-size: 12px;">
        <a href="{{unsubscribeUrl}}">Unsubscribe from these emails</a>
      </p>
    </div>
  </div>
</body>
</html>
```

---

## Template 3: Day 30 Win-Back Email

**Template Name:** `Day 30 Win-Back - Last Chance`
**Subject:** `They're probably hungry by now... 😊`

**Test Data:**
```json
{
  "customerName": "John",
  "recipientName": "Mom",
  "reorderUrl": "https://foodtoindia.com/reorder?orderId=ABC123&campaign=day30",
  "unsubscribeUrl": "https://foodtoindia.com/unsubscribe?email=test@example.com"
}
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>We miss you!</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f5f5f5;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      text-align: center;
      padding: 50px 20px;
      background: linear-gradient(135deg, #fc5c7d 0%, #6a82fb 100%);
      color: white;
    }
    .header-emoji {
      font-size: 70px;
      margin-bottom: 15px;
    }
    .header h1 {
      margin: 0;
      font-size: 36px;
      font-weight: 700;
    }
    .header p {
      margin: 10px 0 0;
      font-size: 18px;
      opacity: 0.9;
    }
    .content {
      padding: 40px;
    }
    .content p {
      line-height: 1.7;
      color: #333;
      margin: 0 0 18px;
      font-size: 16px;
    }
    .social-proof {
      background: linear-gradient(135deg, #e7f3ff 0%, #cfe8ff 100%);
      border-left: 4px solid #007bff;
      padding: 20px 25px;
      margin: 30px 0;
      border-radius: 8px;
      font-style: italic;
    }
    .social-proof p {
      margin: 0;
      color: #004085;
    }
    .social-proof .icon {
      font-size: 24px;
      margin-right: 10px;
    }
    .big-discount {
      background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
      padding: 35px;
      text-align: center;
      margin: 35px 0;
      border-radius: 12px;
      border: 3px solid #dc3545;
    }
    .big-discount p {
      margin: 0 0 15px;
      font-size: 20px;
      font-weight: 600;
      color: #721c24;
    }
    .big-discount-code {
      background-color: white;
      color: #dc3545;
      font-size: 36px;
      font-weight: bold;
      padding: 20px 40px;
      border-radius: 10px;
      display: inline-block;
      letter-spacing: 4px;
      margin: 15px 0;
      border: 4px solid #dc3545;
      box-shadow: 0 4px 20px rgba(220, 53, 69, 0.2);
    }
    .expiry {
      color: #dc3545;
      font-weight: bold;
      font-size: 16px;
      margin-top: 15px;
    }
    .expiry .icon {
      font-size: 20px;
    }
    .cta-button {
      display: inline-block;
      padding: 18px 50px;
      background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
      color: white;
      text-decoration: none;
      border-radius: 30px;
      font-weight: 700;
      font-size: 18px;
      margin: 25px 0;
      transition: all 0.3s;
      box-shadow: 0 6px 25px rgba(220, 53, 69, 0.4);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .cta-button:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 30px rgba(220, 53, 69, 0.5);
    }
    .tip-box {
      background-color: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      margin-top: 35px;
      border: 1px solid #e0e0e0;
    }
    .tip-box p {
      margin: 0;
      font-size: 14px;
      color: #666;
    }
    .footer {
      background-color: #2d3436;
      padding: 35px 40px;
      text-align: center;
      color: white;
    }
    .footer p {
      margin: 5px 0;
      font-size: 14px;
      color: #dfe6e9;
    }
    .footer a {
      color: #74b9ff;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 25px;
      }
      .header h1 {
        font-size: 28px;
      }
      .big-discount {
        padding: 25px;
      }
      .big-discount-code {
        font-size: 28px;
        padding: 15px 30px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header -->
    <div class="header">
      <div class="header-emoji">👋</div>
      <h1>We Miss You!</h1>
      <p>It's been a while...</p>
    </div>

    <!-- Content -->
    <div class="content">
      <p>Hi <strong>{{customerName}}</strong>,</p>

      <p>It's been a month since you sent food to <strong>{{recipientName}}</strong>.</p>

      <p style="font-size: 18px;">They're probably wondering when the next delicious meal is coming! 😄</p>

      <!-- Social Proof -->
      <div class="social-proof">
        <p>
          <span class="icon">💡</span>
          <strong>Did you know?</strong> Our customers send food an average of <strong>5-6 times</strong>. Many send weekly to stay connected with loved ones!
        </p>
      </div>

      <p style="font-size: 17px; font-weight: 600; margin-top: 30px;">
        We're here to make it easy:
      </p>

      <!-- Big Discount -->
      <div class="big-discount">
        <p>Here's <strong style="font-size: 24px;">$5</strong> to send them a surprise:</p>
        <div class="big-discount-code">MONTH5</div>
        <p class="expiry">
          <span class="icon">⚠️</span> Expires in 7 days!
        </p>
      </div>

      <div style="text-align: center;">
        <a href="{{reorderUrl}}" class="cta-button">
          Send Food Now →
        </a>
      </div>

      <!-- Tip Box -->
      <div class="tip-box">
        <p>
          <strong>💡 Pro tip:</strong> Save their address and favorite restaurants for even faster ordering next time! Most orders are completed in under 2 minutes.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p style="font-size: 16px; font-weight: 600; margin-bottom: 15px;">
        - The FoodToIndia Team
      </p>
      <p style="margin-top: 20px;">
        <a href="https://foodtoindia.com">Visit Website</a> •
        <a href="mailto:support@foodtoindia.com">Contact Support</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px;">
        P.S. If you're not interested in these reminders, <a href="{{unsubscribeUrl}}">let us know</a>.
      </p>
    </div>
  </div>
</body>
</html>
```

---

## Template 4: Birthday Reminder Email

**Template Name:** `Birthday Reminder - 7 Days Before`
**Subject:** `🎂 {{recipientName}}'s birthday is in 7 days!`

**Test Data:**
```json
{
  "customerName": "John",
  "recipientName": "Mom",
  "birthdayDate": "January 20th",
  "recipientCity": "Mumbai",
  "birthdayItems": [
    {"emoji": "🎂", "name": "Chocolate Truffle Cake", "restaurant": "CakeZone"},
    {"emoji": "🍰", "name": "Black Forest Cake", "restaurant": "Theobroma"},
    {"emoji": "🍬", "name": "Assorted Sweets Box", "restaurant": "Haldiram's"},
    {"emoji": "🎁", "name": "Birthday Special Thali", "restaurant": "Paradise"}
  ],
  "orderCakeUrl": "https://foodtoindia.com/browse?category=cakes&city=Mumbai&campaign=birthday",
  "browseSweetsUrl": "https://foodtoindia.com/browse?category=sweets&city=Mumbai&campaign=birthday",
  "unsubscribeUrl": "https://foodtoindia.com/unsubscribe?email=test@example.com"
}
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Birthday Coming Up!</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f5f5f5;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      text-align: center;
      padding: 40px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: "🎉🎂🎁✨🎈";
      position: absolute;
      top: -20px;
      left: 0;
      right: 0;
      font-size: 40px;
      opacity: 0.3;
      letter-spacing: 20px;
    }
    .header-emojis {
      font-size: 50px;
      margin-bottom: 15px;
    }
    .header h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 700;
      position: relative;
      z-index: 1;
    }
    .content {
      padding: 35px 40px;
    }
    .content p {
      line-height: 1.6;
      color: #333;
      margin: 0 0 15px;
    }
    .birthday-highlight {
      background: linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%);
      padding: 25px;
      border-radius: 12px;
      text-align: center;
      margin: 25px 0;
      border: 3px solid #f39c12;
    }
    .birthday-highlight p {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #2d3436;
    }
    .birthday-date {
      font-size: 28px;
      color: #e17055;
    }
    .discount-badge {
      background: linear-gradient(135deg, #e7d9f7 0%, #d8b9f7 100%);
      color: #6f42c1;
      font-size: 18px;
      font-weight: bold;
      padding: 12px 25px;
      border-radius: 25px;
      display: inline-block;
      margin: 20px 0;
      border: 2px solid #6f42c1;
    }
    .discount-code {
      background-color: white;
      color: #6f42c1;
      font-size: 24px;
      font-weight: bold;
      padding: 10px 25px;
      border-radius: 8px;
      display: inline-block;
      letter-spacing: 2px;
      margin: 10px 0;
    }
    .item-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin: 25px 0;
    }
    .item-card {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      padding: 20px;
      border-radius: 10px;
      text-align: center;
      border: 2px solid #dee2e6;
      transition: all 0.3s;
    }
    .item-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.1);
      border-color: #6f42c1;
    }
    .item-emoji {
      font-size: 40px;
      margin-bottom: 10px;
    }
    .item-name {
      font-weight: 600;
      color: #333;
      margin: 5px 0;
      font-size: 15px;
    }
    .item-restaurant {
      color: #666;
      font-size: 13px;
    }
    .button-group {
      text-align: center;
      margin: 30px 0;
    }
    .cta-button {
      display: inline-block;
      padding: 15px 35px;
      color: white;
      text-decoration: none;
      border-radius: 25px;
      font-weight: 600;
      margin: 10px 5px;
      transition: all 0.3s;
      font-size: 16px;
    }
    .btn-cake {
      background: linear-gradient(135deg, #6f42c1 0%, #5a31a0 100%);
      box-shadow: 0 4px 15px rgba(111, 66, 193, 0.3);
    }
    .btn-sweets {
      background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
      box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);
    }
    .cta-button:hover {
      transform: translateY(-2px);
    }
    .delivery-note {
      background-color: #d1ecf1;
      border-left: 4px solid #17a2b8;
      padding: 15px 20px;
      border-radius: 4px;
      margin: 25px 0;
    }
    .delivery-note p {
      margin: 0;
      color: #0c5460;
      font-size: 14px;
    }
    .footer {
      background-color: #f9f9f9;
      padding: 30px 40px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .footer p {
      margin: 5px 0;
      font-size: 14px;
      color: #666;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 25px 20px;
      }
      .item-grid {
        grid-template-columns: 1fr;
      }
      .cta-button {
        display: block;
        margin: 10px 0;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header -->
    <div class="header">
      <div class="header-emojis">🎂🎉🎁</div>
      <h1>Birthday Coming Up!</h1>
    </div>

    <!-- Content -->
    <div class="content">
      <p>Hi <strong>{{customerName}}</strong>,</p>

      <!-- Birthday Highlight -->
      <div class="birthday-highlight">
        <p>🎈 <strong>{{recipientName}}'s birthday</strong> is in <span style="color: #e17055;">7 days!</span></p>
        <p class="birthday-date">{{birthdayDate}}</p>
      </div>

      <p style="font-size: 17px;">Make their day extra special with a delicious treat from <strong>{{recipientCity}}</strong>! 🎉</p>

      <!-- Discount -->
      <div style="text-align: center; margin: 25px 0;">
        <div class="discount-badge">
          🎁 Birthday Special: <strong>10% off</strong> all birthday orders
        </div>
        <div class="discount-code">BDAY10</div>
      </div>

      <p style="margin-top: 30px; font-weight: 600; font-size: 16px;">
        🍰 Popular birthday items in {{recipientCity}}:
      </p>

      <!-- Item Grid -->
      <div class="item-grid">
        {{#each birthdayItems}}
        <div class="item-card">
          <div class="item-emoji">{{this.emoji}}</div>
          <div class="item-name">{{this.name}}</div>
          <div class="item-restaurant">{{this.restaurant}}</div>
        </div>
        {{/each}}
      </div>

      <!-- CTA Buttons -->
      <div class="button-group">
        <a href="{{orderCakeUrl}}" class="cta-button btn-cake">
          🎂 Order Birthday Cake
        </a>
        <a href="{{browseSweetsUrl}}" class="cta-button btn-sweets">
          🍬 Browse Sweets
        </a>
      </div>

      <!-- Delivery Note -->
      <div class="delivery-note">
        <p>
          🚚 <strong>Same-day delivery available!</strong> Most restaurants in {{recipientCity}} can deliver today.
        </p>
      </div>

      <p style="margin-top: 30px; text-align: center; color: #666; font-size: 14px; font-style: italic;">
        Make birthdays special, from anywhere in the world ❤️
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p style="font-weight: 600;">- The FoodToIndia Team</p>
      <p style="margin-top: 15px;">
        <a href="https://foodtoindia.com">Visit Website</a> •
        <a href="mailto:support@foodtoindia.com">Contact Support</a>
      </p>
      <p style="margin-top: 15px; font-size: 12px;">
        <a href="{{unsubscribeUrl}}">Unsubscribe from birthday reminders</a>
      </p>
    </div>
  </div>
</body>
</html>
```

---

## SendGrid Setup Checklist

### 1. Create Account
- [ ] Sign up at sendgrid.com
- [ ] Verify email address
- [ ] Choose Free plan (100 emails/day)

### 2. Domain Authentication (Optional but Recommended)
- [ ] Add domain in Settings → Sender Authentication
- [ ] Add DNS records (SPF, DKIM, DMARC)
- [ ] Verify domain

### 3. Create Templates
- [ ] Go to Email API → Dynamic Templates
- [ ] Create each template above
- [ ] Copy HTML code
- [ ] Add test data and preview
- [ ] Save and note Template ID

### 4. Get API Key
- [ ] Go to Settings → API Keys
- [ ] Create API Key with "Full Access"
- [ ] Copy key (only shown once!)
- [ ] Store in Firebase config

### 5. Configure Webhooks (Optional)
- [ ] Go to Settings → Mail Settings → Event Webhook
- [ ] Add webhook URL: `https://YOUR-PROJECT.cloudfunctions.net/emailWebhook`
- [ ] Select events: Delivered, Opened, Clicked
- [ ] This enables open/click tracking

---

## Testing Templates

### In SendGrid Dashboard:

1. Click "Test Your Template"
2. Paste test data (provided above each template)
3. Send test email to yourself
4. Verify:
   - [ ] Email renders correctly
   - [ ] All variables populated
   - [ ] Links work
   - [ ] Mobile responsive
   - [ ] Unsubscribe link present

### Common Issues:

**Variables not showing:**
- Check JSON syntax in test data
- Ensure variable names match `{{variableName}}`

**Handlebars loops not working:**
- Use `{{#each array}}` for arrays
- Use `{{this}}` or `{{this.property}}` inside loop

**Styling broken:**
- Use inline CSS for email compatibility
- Test in multiple email clients

---

## Next Steps

1. Create templates in SendGrid
2. Note down Template IDs
3. Update `functions/email/sendEmail.js` with IDs
4. Deploy Firebase Functions
5. Test with real orders
6. Monitor delivery rates

For implementation details, see [retention-implementation-guide.md](./retention-implementation-guide.md)

---

*Last Updated: January 13, 2026*
