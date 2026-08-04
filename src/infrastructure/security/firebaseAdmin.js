import admin from "firebase-admin";
import "dotenv/config";

// Helper to ensure the private key is formatted correctly.
// Environment variables often escape newlines (turning actual line breaks into literal "\n" characters).
// The Admin SDK requires actual line breaks to parse the certificate.
const formatPrivateKey = (key) => {
  if (!key) return undefined;
  // Remove wrapping quotes if they exist
  let formattedKey = key.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  // Replace literal '\n' characters with actual newlines
  formattedKey = formattedKey.replace(/\\n/g, "\n");
  // Trim any stray whitespace or trailing newlines
  return formattedKey.trim();
};

let adminAuthInstance = null;

// Only initialize if no apps are running (prevents errors on server restarts)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      }),
    });
    adminAuthInstance = admin.auth();
    console.log("Firebase Admin initialized successfully.");
  } catch (error) {
    console.error("\n❌ Firebase Admin Initialization Error:");
    console.error("The FIREBASE_PRIVATE_KEY in your .env file is likely formatted incorrectly.");
    console.error(error.message, "\n");
  }
}

// Export the auth module so you can use it in your controllers/use-cases
export const firebaseAuth = adminAuthInstance;
