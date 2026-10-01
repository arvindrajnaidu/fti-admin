# FoodtoIndia Admin Tool - Project Plan

## Overview
Internal order management tool for viewing and managing all orders across the FoodtoIndia platform.

## Purpose
- View all orders from all users in one place
- Track order status and details
- Search and filter orders
- Update order status (dispatch, cancel)
- Generate reports and insights

## Technical Stack
- **Framework**: Next.js 11 (matching main app)
- **UI**: Simple HTML tables with basic CSS (no complex UI library initially)
- **Database**: Firebase Firestore (shared with main app)
- **Authentication**: Firebase Auth (admin whitelist)
- **Deployment**: Separate from main app (Vercel recommended)

## Firebase Projects
- **Development**: `foodtoindia-dev`
- **Production**: `foodtoindia`

Environment switching based on `VERCEL_ENV` or `NODE_ENV`

## Data Structure
```
Firebase Firestore:
users/{userId}/orders/{orderId}
  - createdAt: timestamp
  - updatedAt: timestamp
  - status: string (pending, dispatched, cancelled)
  - restaurantName: string
  - restaurantId: string
  - recipient: {
      name: string
      phone: string
      location: {
        city: string
        formattedAddress: string
      }
    }
  - lineItems: object
  - subTotal: number
  - deliveryFee: number
  - tax: number
  - totalAmount: number
  - paymentMethod: string
  - tracking_link: string (optional)
```

## Features - Phase 1 (MVP)
1. ✅ Authentication (admin only)
2. ✅ View all orders in a table
3. ✅ Basic columns:
   - Order ID
   - Date
   - Sender Email
   - Recipient Name
   - Recipient City
   - Restaurant Name
   - Total Amount
   - Status
4. ✅ Simple search by order ID or email
5. ✅ Click to view order details

## Features - Phase 2 (Future)
- Date range filtering
- Status filtering
- Export to CSV
- Update tracking link
- Cancel order
- Order statistics dashboard
- Bulk operations

## Security
- Admin email whitelist in environment variables
- Server-side only queries using Firebase Admin SDK
- No client-side Firebase access for admin functions

## File Structure
```
/admin
  /docs
    - PROJECT_PLAN.md (this file)
    - DEPLOYMENT.md
  /pages
    /api
      - orders.js (fetch all orders)
    - index.js (orders list)
    - [id].js (order detail)
  /lib
    - firebase.js (Firebase Admin SDK setup)
    - auth.js (admin authentication)
  /components
    - OrdersTable.js
    - OrderDetail.js
  - package.json
  - .env.local.example
  - README.md
```

## Development Workflow
1. Build on dev environment first (`foodtoindia-dev`)
2. Test thoroughly
3. Deploy to production (`foodtoindia`)

## Deployment
- Host on Vercel (separate from main app)
- Environment variables for Firebase credentials
- Admin whitelist emails

## Timeline
- Phase 1 (MVP): 1-2 days
- Phase 2 (Enhanced): As needed
