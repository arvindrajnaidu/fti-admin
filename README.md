# FoodtoIndia Admin Tool

Internal order management tool for viewing and managing all orders across the FoodtoIndia platform.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```
   Then edit `.env.local` and add your Firebase Admin SDK private key.

3. **Run development server:**
   ```bash
   npm run dev
   ```
   The app will be available at http://localhost:3001

4. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

## Environment Configuration

### Development (default)
- Connects to `foodtoindia-dev` Firebase project
- No environment variables needed for dev mode

### Production
Set one of these environment variables:
```bash
VERCEL_ENV=production
# OR
NODE_ENV=production
```

## Features

- View all orders from all users
- Search by order ID, email, recipient name, or restaurant
- Display key information:
  - Order ID and date
  - Sender information
  - Recipient name, phone, and city
  - Restaurant name
  - Number of items
  - Total amount
  - Payment method
  - Order status (pending/dispatched/cancelled)

## Project Structure

```
/admin
  /docs          - Project documentation
  /pages
    /api
      orders.js  - API endpoint to fetch all orders
    index.js     - Main orders list page
  /lib
    firebase.js  - Firebase Admin SDK configuration
  /components    - Reusable React components (future)
```

## Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard:
   - `FIREBASE_PRIVATE_KEY`
   - `VERCEL_ENV=production` (for prod deployment)
4. Deploy

## Security Notes

- This tool uses Firebase Admin SDK (server-side only)
- No client-side Firebase access
- Add authentication layer before deploying (TODO)
- Do not expose this publicly without authentication

## Future Enhancements

- User authentication (admin whitelist)
- Order detail view page
- Update order status (dispatch, cancel)
- Add tracking link
- Date range filtering
- Export to CSV
- Order statistics dashboard
- Pagination for large datasets

## Support

For issues or questions, contact the development team.
