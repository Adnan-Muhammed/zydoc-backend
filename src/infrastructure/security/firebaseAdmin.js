// src/infrastructure/security/firebaseAdmin.js
import admin from "firebase-admin";
import "dotenv/config";

/**
 * Formats the Firebase private key from .env.
 *
 * When you copy a private key into a .env file it ends up with literal
 * "\n" two-character sequences instead of real newline characters.
 * The Firebase Admin SDK requires real newlines to parse the PEM certificate,
 * so we replace them here.
 *
 * We also strip any wrapping quotes that some .env loaders add.
 */
const formatPrivateKey = (key) => {
  if (!key) return undefined;
  // Strip surrounding quotes (single or double) added by some env parsers
  let formatted = key.replace(/^["']|["']$/g, "");
  // Replace literal two-character sequence  \n  with a real newline character
  formatted = formatted.replace(/\\n/g, "\n");
  return formatted.trim();
};

// Prevent double-initialisation on hot-reloads (development) or Lambda warm starts
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      }),
    });
    // console.log("✅ Firebase Admin SDK initialized successfully.");
  // console log commented   
  } catch (error) {
    console.error("\n❌ Firebase Admin Initialization Error:");
    console.error(
      "  → Check that FIREBASE_PRIVATE_KEY in your .env has no extra quotes and uses literal \\n for newlines."
    );
    console.error("  →", error.message, "\n");
  }
}

// Export individual service handles for clean, explicit imports elsewhere
export const firebaseAuth = admin.apps.length ? admin.auth() : null;
export const firebaseMessaging = admin.apps.length ? admin.messaging() : null;

// Also export the admin object itself for any advanced use-cases
export default admin;
