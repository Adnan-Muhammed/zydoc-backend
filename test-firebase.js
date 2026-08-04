import "dotenv/config";
import admin from "firebase-admin";

const formatPrivateKey = (key) => {
  if (!key) return undefined;
  let formattedKey = key.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  formattedKey = formattedKey.replace(/\\n/g, "\n");
  return formattedKey.trim();
};

console.log("Raw Key Snippet:", process.env.FIREBASE_PRIVATE_KEY.substring(0, 40));

try {
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  console.log("Formatted Key starts with:", privateKey.substring(0, 40));
  console.log("Formatted Key ends with:", privateKey.substring(privateKey.length - 30));

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
  console.log("Firebase Admin initialized successfully.");
} catch (error) {
  console.error("Initialization error:", error.message);
}
