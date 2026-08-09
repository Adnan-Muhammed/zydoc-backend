// src/infrastructure/services/FcmService.js

import { firebaseMessaging } from "../security/firebaseAdmin.js";

/**
 * FcmService — Infrastructure layer service for Firebase Cloud Messaging.
 *
 * Responsibilities:
 *  - Send targeted push notifications to a single device (by FCM token).
 *  - Send multicast notifications to multiple devices at once.
 *  - Gracefully handle stale / invalid tokens so callers don't crash.
 *
 * This class is a pure infrastructure concern. It has NO knowledge of
 * business rules — that belongs in the application use-case layer.
 */
class FcmService {
  /**
   * Send a push notification to a single FCM device token.
   *
   * @param {string} fcmToken  - The recipient device's FCM registration token.
   * @param {object} notification - { title: string, body: string }
   * @param {object} [data]    - Optional key-value string payload for the client app.
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async sendToDevice(fcmToken, notification, data = {}) {
    if (!firebaseMessaging) {
      console.error("[FcmService] Firebase Messaging is not initialized. Check firebaseAdmin.js.");
      return { success: false, error: "FCM not initialized" };
    }

    if (!fcmToken) {
      console.warn("[FcmService] sendToDevice called with no FCM token. Skipping.");
      return { success: false, error: "No FCM token provided" };
    }

    // Ensure all data values are strings — FCM requires this
    const stringifiedData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: stringifiedData,
      // Android-specific: high-priority ensures delivery even in Doze mode
      android: {
        priority: "high",
        notification: {
          sound: "default",
          clickAction: "FLUTTER_NOTIFICATION_CLICK", // harmless on web
        },
      },
      // APNS (iOS) config
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
      // Web Push config — makes the notification show even when the tab is closed
      webpush: {
        notification: {
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          requireInteraction: false,
        },
        fcmOptions: {
          link: "/", // URL to open when notification is clicked
        },
      },
    };

    try {
      const messageId = await firebaseMessaging.send(message);
      // console.log(`[FcmService] ✅ Notification sent. MessageId: ${messageId}`);
      // console log commented 
      return { success: true, messageId };
    } catch (error) {
      // Firebase throws specific error codes for invalid/expired tokens.
      // These are expected in production and should NOT crash the app.
      const isTokenError =
        error.code === "messaging/registration-token-not-registered" ||
        error.code === "messaging/invalid-registration-token";

      if (isTokenError) {
        console.warn(
          `[FcmService] ⚠️ Stale or invalid FCM token detected. Token should be removed from DB.`,
          { code: error.code }
        );
        return { success: false, error: "stale_token", code: error.code };
      }

      console.error("[FcmService] ❌ Failed to send notification:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a notification to multiple FCM tokens at once (max 500 per call).
   *
   * @param {string[]} fcmTokens - Array of recipient device FCM tokens.
   * @param {object} notification - { title: string, body: string }
   * @param {object} [data]       - Optional key-value string payload.
   * @returns {Promise<{ successCount: number, failureCount: number, responses: object[] }>}
   */
  async sendToMultipleDevices(fcmTokens, notification, data = {}) {
    if (!firebaseMessaging) {
      console.error("[FcmService] Firebase Messaging is not initialized.");
      return { successCount: 0, failureCount: fcmTokens.length, responses: [] };
    }

    if (!fcmTokens || fcmTokens.length === 0) {
      return { successCount: 0, failureCount: 0, responses: [] };
    }

    const stringifiedData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const multicastMessage = {
      tokens: fcmTokens.slice(0, 500), // FCM hard limit
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: stringifiedData,
      android: { priority: "high" },
      webpush: {
        notification: {
          icon: "/favicon.ico",
          requireInteraction: false,
        },
      },
    };

    try {
      const batchResponse = await firebaseMessaging.sendEachForMulticast(multicastMessage);
      // console.log(
      //   `[FcmService] Multicast complete. ✅ ${batchResponse.successCount} sent, ❌ ${batchResponse.failureCount} failed.`
      // );
      // console log commented 
      return {
        successCount: batchResponse.successCount,
        failureCount: batchResponse.failureCount,
        responses: batchResponse.responses,
      };
    } catch (error) {
      console.error("[FcmService] ❌ Multicast send failed:", error.message);
      return { successCount: 0, failureCount: fcmTokens.length, responses: [], error: error.message };
    }
  }
}

// Export as a singleton — the Admin SDK is already a singleton,
// so all imports share the same underlying connection.
export const fcmService = new FcmService();
