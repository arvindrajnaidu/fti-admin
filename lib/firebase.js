const admin = require("firebase-admin");

if (!admin.apps.length) {
  // Use FIREBASE_ENV instead of NODE_ENV because Next.js dev mode forces NODE_ENV=development
  const isProduction = process.env.FIREBASE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  const projectId = isProduction ? "foodtoindia" : "foodtoindia-dev";
  const clientEmail = isProduction
    ? "firebase-adminsdk-cgjg4@foodtoindia.iam.gserviceaccount.com"
    : "firebase-adminsdk-4g5z3@foodtoindia-dev.iam.gserviceaccount.com";
  const databaseURL = isProduction
    ? "https://foodtoindia.firebaseio.com"
    : "https://foodtoindia-dev.firebaseio.com";
  const storageBucket = isProduction
    ? "foodtoindia.appspot.com"
    : "foodtoindia-dev.appspot.com";

  // Check if private key is available
  if (!process.env.FIREBASE_PRIVATE_KEY) {
    console.error('FIREBASE_PRIVATE_KEY environment variable is not set');
    console.error('Please create .env.local file with your Firebase private key');
    // Don't initialize - let API routes handle the error
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      databaseURL,
      storageBucket,
    });

    console.log(`Firebase Admin initialized for: ${projectId}`);
  }
}

let db;
if (admin.apps.length) {
  db = admin.firestore();
  // Only call settings if not already initialized
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (err) {
    // Settings already applied, ignore error
  }
} else {
  db = null;
}

module.exports = {
  admin,
  db
};
