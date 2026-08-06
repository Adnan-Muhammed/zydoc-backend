# Project Context: Doctor Consultation & Booking API
**Architecture:** Clean Architecture (Node.js/Express)
**Goal:** Implement Slot Locking, Razorpay Payment integration, Multi-vendor split, and Socket/FCM Notifications.

## Development Roadmap

### Day 1: Slot Locking & Database Schema Update
*   **Database Models (`src/infrastructure/database/models`):** 
    * Update `Appointment.js` schema to include `lockedBy`, `lockExpiryTime`, `paymentId`, `adminCommission`, `doctorAmount`, `consultationType` (Online/Offline), and `status` (Available, Locked, Scheduled, Completed).
    * Create a new `Transaction.js` model for admin/doctor revenue tracking.
    * Update `DoctorProfile.js` & `PatientProfile.js` to include `fcmToken` field.
*   **Repositories (`src/infrastructure/repositories` & `domain/repositories`):**
    * Update `AppointmentRepository` with methods for `lockSlot`, `unlockSlot`, and `findExpiredLocks`.
    * Create `TransactionRepository`.
*   **Use Cases (`src/application/usecases/appointment`):** 
    * Create `LockSlot.js` (lock slot for 5 mins).
    * Create `UnlockSlot.js` (instant unlock if user cancels).
*   **Cron Job (`src/infrastructure/cron`):** 
    * Create `SlotCron.js` using `node-cron` to auto-release expired locked slots.
*   **Controllers & Routes:** 
    * Update `src/presentation/controllers/AppointmentController.js` and `src/presentation/routes/appointmentRoutes.js` with lock/unlock endpoints.

### Day 2: Payment Integration & Webhooks
*   **Payment Service (`src/infrastructure/services/PaymentService.js`):** 
    * Implement Razorpay instance using `key_id` and `key_secret` from `.env`.
*   **Use Cases (`src/application/usecases/payment`):** 
    * Create `CreatePaymentOrder.js`.
    * Create `VerifyPaymentWebhook.js` (includes commission split logic calculating admin % and doctor %, and updates Appointment status).
*   **Controllers & Routes:** 
    * Create `PaymentController.js` and corresponding routes for order generation and webhook listening.

### Day 2.5: Data Cleanup, Commission Logic & Fetch APIs
*   **Transient State Cleanup (Database Efficiency):**
    * Update the `Appointment` model to use a TTL Index OR update `UnlockSlot.js` and `SlotCron.js` to permanently `delete` temporary `Locked` documents that fail to complete payment within 5 minutes, keeping the database clean.
*   **Commission & Escrow Logic:**
    * Inside `VerifyPayment` or a new transaction use case, dynamically calculate the commission split based on `consultationType` (e.g., 20% for Online, 10% for Offline).
    * Generate a `Transaction` record with `adminCommission`, `doctorAmount`, and `payoutStatus: Pending`.
*   **List Fetching APIs (Controllers & Routes):**
    * Create `GET /api/appointments/patient`: Fetch appointments matching the current patient's ID.
    * Create `GET /api/appointments/doctor`: Fetch upcoming consultations for the current doctor.
    * Create `GET /api/appointments/admin`: Fetch a master list of all system appointments and their associated transaction data.

### Day 3: Real-time Notifications & Emails
*   **Use Cases (`src/application/usecases/notifications`):**
    * Create `UpdateFCMToken.js` (to save the token received from frontend).
    * Create `SendBookingNotification.js` (Orchestrates checking if doctor is online -> send socket, if offline -> send FCM).
*   **Socket Service (`src/infrastructure/services/SocketService.js`):** 
    * Setup Socket.io. Map `socketId` to `doctorId`. Emit `new_booking` event.
*   **Push & Email (`src/infrastructure/security`):** 
    * Use existing `firebaseAdmin.js` to send FCM push to offline doctors/assistants.
    * Use existing `MailService.js` to send booking confirmation emails to both patient and doctor.
*   **Controllers & Routes:**
    * Add endpoint to save FCM token.