# Appointment Timing Rules & Video Consultation Lifecycle

This document defines the comprehensive timing equations, boundary conditions, master schedule matrix, and extension/handover rules for video consultations on ZyDoc.

---

## Part 1: Field Equations & Boundary Conditions

### 1. Duration
Booked consultation duration.  
**Standard durations supported:** `10`, `15`, `20`, `25`, `30`, and `45` minutes.

---

### 2. Scheduled Start (`ScheduledStartAt`)
Normal starting time of the appointment:
$$\text{ScheduledStartAt} = \text{BookingSlotStartAt} \quad (\text{e.g., } 9:00\text{ AM})$$

---

### 3. Maximum Early Join (`EarlyJoinAt`)
The earliest boundary at which a patient can enter the waiting room:
$$\text{EarlyJoinAt} = \text{ScheduledStartAt} - 10\text{ minutes} \quad (\text{e.g., } 8:50\text{ AM})$$

---

### 4. Maximum Early Start (`EarlyStartAt`)
The earliest boundary allowing a doctor and patient to initiate the live consultation early:
$$\text{EarlyStartAt} = \text{EarlyJoinAt} + 3\text{ minutes} = \text{ScheduledStartAt} - 7\text{ minutes} \quad (\text{e.g., } 8:53\text{ AM})$$

---

### 5. Last Join Grace & Last Join (`LateJoinGrace` & `LastJoinAt`)
Grace period and absolute latest time allowed for a late join:
$$\text{LateJoinGrace} = \min(\text{Duration} \times 25\%, 10\text{ minutes})$$
$$\text{LastJoinAt} = \text{ScheduledStartAt} + \text{LateJoinGrace}$$

*Example (10-minute slot):*
$$\text{LateJoinGrace} = \min(10 \times 0.25, 10) = 2.5 \rightarrow 2\text{ minutes}$$
$$\text{LastJoinAt} = 9:00\text{ AM} + 2\text{ minutes} = 9:02\text{ AM}$$

---

### 6. Last Booking Cutoff (`LastBookingAt`)
Absolute latest time allowing new bookings and payments for a slot:
$$\text{LastBookingAt} = \text{LastJoinAt} - 5\text{ minutes} \quad (\text{e.g., } 9:02 - 5\text{ minutes} = 8:57\text{ AM})$$

---

### 7. Scheduled End (`ScheduledEndAt`)
Normal end time based on the scheduled duration:
$$\text{ScheduledEndAt} = \text{ScheduledStartAt} + \text{Duration} \quad (\text{e.g., } 9:00\text{ AM} + 10\text{ min} = 9:10\text{ AM})$$

---

### 8. Duration End (`DurationEndAt` — 3 Start States)

- **State 1: Early Start**
  $$\text{DurationEndAt} = \text{ActualStartAt} + \text{Duration}$$
  *(e.g., starting early at 8:53 AM with 10 mins ends at 9:03 AM)*

- **State 2: On-Time**
  $$\text{DurationEndAt} = \text{ActualStartAt} + \text{Duration}$$
  *(e.g., starting punctually at 9:00 AM with 10 mins ends at 9:10 AM)*

- **State 3: Late Start**
  $$\text{DurationEndAt} = \min(\text{ActualStartAt} + \text{Duration}, \text{ScheduledEndAt})$$
  *(e.g., starting late at 9:02 AM still ends the duration precisely at Scheduled End 9:10 AM; lost time is not refunded)*

---

### 9. Max Extension & Actual End (`ActualEnd`)
Maximum extra time allowed for a consultation when extended:
- **Max Extension:** Up to `+10 minutes`.
- **Actual End Time:**
  $$\text{ActualEnd} = \text{DurationEndAt} + 10\text{ minutes} \quad (\text{capped at slot limits if another patient exists})$$

---

## Part 2: Full Master Table (Duration & 3 States)

*Calculations based on an illustrative **9:00 AM Scheduled Start Time**:*

| Duration | State | Last Booking | Early Join | Early Start | Scheduled Start | Actual Start | Last Join | Scheduled End | Join Time | Duration End | Max Extension | Actual End |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **10 min** | **Early Start** | 8:57 | 8:50 | 8:53 | 9:00 | 8:53 | 9:02 | 9:10 | 8:53 | **9:03** | +10 min | **9:13** |
| 10 min | **On-Time** | 8:57 | 8:50 | 8:53 | 9:00 | 9:00 | 9:02 | 9:10 | 9:00 | **9:10** | +10 min | **9:20** |
| 10 min | **Late** | 8:57 | 8:50 | 8:53 | 9:00 | 9:02 | 9:02 | 9:10 | 9:02 | **9:10** | +10 min | **9:20** |
| **15 min** | **Early Start** | 8:59 | 8:50 | 8:53 | 9:00 | 8:53 | 9:04 | 9:15 | 8:53 | **9:08** | +10 min | **9:18** |
| 15 min | **On-Time** | 8:59 | 8:50 | 8:53 | 9:00 | 9:00 | 9:04 | 9:15 | 9:00 | **9:15** | +10 min | **9:25** |
| 15 min | **Late** | 8:59 | 8:50 | 8:53 | 9:00 | 9:04 | 9:04 | 9:15 | 9:04 | **9:15** | +10 min | **9:25** |
| **20 min** | **Early Start** | 9:00 | 8:50 | 8:53 | 9:00 | 8:53 | 9:05 | 9:20 | 8:53 | **9:13** | +10 min | **9:23** |
| 20 min | **On-Time** | 9:00 | 8:50 | 8:53 | 9:00 | 9:00 | 9:05 | 9:20 | 9:00 | **9:20** | +10 min | **9:30** |
| 20 min | **Late** | 9:00 | 8:50 | 8:53 | 9:00 | 9:05 | 9:05 | 9:20 | 9:05 | **9:20** | +10 min | **9:30** |
| **25 min** | **Early Start** | 9:01 | 8:50 | 8:53 | 9:00 | 8:53 | 9:06 | 9:25 | 8:53 | **9:18** | +10 min | **9:28** |
| 25 min | **On-Time** | 9:01 | 8:50 | 8:53 | 9:00 | 9:00 | 9:06 | 9:25 | 9:00 | **9:25** | +10 min | **9:35** |
| 25 min | **Late** | 9:01 | 8:50 | 8:53 | 9:00 | 9:06 | 9:06 | 9:25 | 9:06 | **9:25** | +10 min | **9:35** |
| **30 min** | **Early Start** | 9:03 | 8:50 | 8:53 | 9:00 | 8:53 | 9:08 | 9:30 | 8:53 | **9:23** | +10 min | **9:33** |
| 30 min | **On-Time** | 9:03 | 8:50 | 8:53 | 9:00 | 9:00 | 9:08 | 9:30 | 9:00 | **9:30** | +10 min | **9:40** |
| 30 min | **Late** | 9:03 | 8:50 | 8:53 | 9:00 | 9:08 | 9:08 | 9:30 | 9:08 | **9:30** | +10 min | **9:40** |
| **45 min** | **Early Start** | 9:05 | 8:50 | 8:53 | 9:00 | 8:53 | 9:10 | 9:45 | 8:53 | **9:38** | +10 min | **9:48** |
| 45 min | **On-Time** | 9:05 | 8:50 | 8:53 | 9:00 | 9:00 | 9:10 | 9:45 | 9:00 | **9:45** | +10 min | **9:55** |
| 45 min | **Late** | 9:05 | 8:50 | 8:53 | 9:00 | 9:10 | 9:10 | 9:45 | 9:10 | **9:45** | +10 min | **9:55** |

---

## Part 3: Extension Rules & Next-Slot Joining Rules

### Rule 1: If No Next Patient
If no patient is booked in the next slot, the doctor can extend the current consultation beyond its standard duration up to a maximum of **+10 minutes** (`Max Extension`).

#### Example 1 (Early Start Case):
- **Situation:** 10-minute slot (`9:00 - 9:10 AM`). Doctor and patient start early at `8:53 AM`.
- **Duration End:** Finishes at `9:03 AM` ($8:53 + 10\text{ min}$).
- **Extension:** With no next patient, doctor can extend by another `+10 minutes` up to **9:13 AM** (`Actual End`).

#### Example 2 (On-Time Case):
- **Situation:** 10-minute slot (`9:00 - 9:10 AM`). Started punctually at `9:00 AM`.
- **Duration End:** Finishes at `9:10 AM` ($9:00 + 10\text{ min}$).
- **Extension:** With no next patient, adding `+10 minutes` stretches it up to **9:20 AM** (`Actual End`).

#### Example 3 (Late Start Case):
- **Situation:** 10-minute slot (`9:00 - 9:10 AM`). Doctor/patient joined late at `9:02 AM`.
- **Duration End:** Ends at the Scheduled End of `9:10 AM` ($\min(9:02 + 10\text{ min}, 9:10)$).
- **Extension:** Adding the maximum extension of `+10 minutes` allows the call to continue up to **9:20 AM** (`Actual End`).

---

### Rule 2: If the Next Patient (Patient B) Goes Live — 20-Sec Auto-Cut & Doctor Action
If the next patient goes live during their scheduled start or within their late join grace period, the system automatically cuts the ongoing call.

#### Step 1: Patient B Goes Live
While the doctor is extending Patient A's consultation (slot `9:00 - 9:10 AM`), Patient B (slot `9:10 - 9:20 AM`) enters the app and waits live within their late join timeframe.

#### Step 2: 20-Second Auto-Cut
The system immediately detects Patient B's presence and initiates a **20-second countdown**. Within 20 seconds, the system automatically marks Patient A's call as **"Complete"** and terminates the session.
> [!NOTE]
> Since the system performs this cut automatically, it is **not considered a doctor fault**.

#### Step 3: Doctor's Responsibility
Once the call is cut and the doctor is returned to the dashboard, the doctor must **promptly and manually join Patient B's live room** to start the consultation.
> [!WARNING]
> Failing to join promptly will be flagged as a **Doctor's Issue**.

---

### Rule 2.1: If Patient B Joins Early (Patient B Early Join Scenario)

- **Early Join Privilege:** Although Patient B's slot is `9:10 - 9:20 AM`, Patient B has the facility to perform an Early Join starting from `9:00 AM` (10 minutes prior).
- **Scenario A (Doctor is Free):** If the doctor is free at that time (or if Patient A's call finished early), the doctor can start Patient B's consultation early starting from the Early Start time of **9:03 AM** onwards, without having to wait until 9:10 AM.
- **Scenario B (Doctor is Busy with Patient A):** Even though Patient B is waiting live early, the current call can continue up to its Scheduled End (**9:10 AM**). However, if Patient B is live when the clock strikes **9:10 AM**, the system will trigger the **20-second timer** to automatically cut Patient A's call. The doctor must then navigate back to the dashboard and manually join Patient B's call.

---

### Rule 3: Duration-Based Late Join (Late Join Grace Variation)
The late join grace period scales proportionally with slot duration according to:
$$\text{LateJoinGrace} = \min(\text{Duration} \times 25\%, 10\text{ minutes})$$

#### Examples:
1. **10-Minute Slot:**
   - Calculation: $10\text{ min} \times 25\% = 2.5\text{ min} \rightarrow \mathbf{2\text{ minutes}}$
   - Last Join: `9:00 AM + 2 min` = **9:02 AM**
2. **20-Minute Slot:**
   - Calculation: $20\text{ min} \times 25\% = \mathbf{5\text{ minutes}}$
   - Last Join: `9:00 AM + 5 min` = **9:05 AM**
3. **45-Minute Slot:**
   - Calculation: $45\text{ min} \times 25\% = 11.25\text{ min} \rightarrow \mathbf{10\text{ minutes}}$ *(capped at maximum 10 minutes)*
   - Last Join: `9:00 AM + 10 min` = **9:10 AM**
---

### Rule 4: Minimum 3-Minute Consultation Lock
To safeguard clinical quality and prevent accidental or premature call terminations:
1. **Minimum Active Duration:** The doctor **cannot** end the consultation until a minimum of **3 minutes** ($180\text{ seconds}$) of active call time has elapsed.
2. **Blocking Notification:** If the doctor attempts to click "End Call" before 3 minutes have passed, the action is blocked, and the system displays a mandatory modal/pop-up:
   > *"Minimum 3 minutes of consultation is required before ending this session."*
   The prompt informs the doctor of their current elapsed time and the remaining lock time.
3. **Strict Re-Join Prevention:** Once the doctor successfully clicks "End Call" after the 3-minute mark, the session is permanently concluded. Re-joining the consultation room is strictly blocked for all participants, and both the doctor and patient are automatically redirected back to their respective dashboards.

---

### Rule 5: Refresh & Pull-to-Refresh Gesture Prevention
To prevent unexpected state resets, WebRTC connection dropouts, and socket termination during active consultations:
1. **Keyboard Reload Lock:** Browser shortcut keys for page refresh (`F5`, `Ctrl + R`, `Cmd + R`, `Ctrl + Shift + R`, `Cmd + Shift + R`) are actively intercepted and disabled within the video room.
2. **Mobile Pull-to-Refresh Lock:** Touch gestures triggering vertical pull-to-refresh on mobile devices are disabled using strict CSS containment (`overscroll-behavior-y: contain`) and touch event interception.
3. **Navigation Interception:** Native tab/window closures and in-app navigation clicks trigger a confirmation dialogue (`usePreventCallExit`).

---

### Rule 6: Network Disconnect & Reconnect Handling (30-Second Grace Buffer)
To protect clinical consultations against transient network blips, packet loss, or brief WiFi/cellular handoffs:
1. **30-Second Grace Period:** If a participant's socket or WebRTC connection temporarily drops, the server initiates a **30-second reconnection grace period** rather than immediately destroying the room.
2. **Peer Notification:** The remaining participant receives a real-time status banner: *"Participant connection lost. Reconnecting... (grace period: 30s)"*.
3. **Seamless Resumption:** If the disconnected participant reconnects within the 30-second window, they rejoin the exact active WebRTC session without resetting call timers or room state.
4. **State Persistence:** Redux and local session storage retain active session metadata so that UI states and clinical sidebar notes remain intact upon reconnect.

---

### Rule 7: Max Extension Hard-Stop
When there is no subsequent patient waiting:
1. **Extension Cap:** The consultation can extend up to a maximum allowed **+10 minute extension** beyond the duration end time:
   $$\text{ActualEndAt} = \text{DurationEndAt} + 10\text{ minutes}$$
2. **Automated Termination:** Once this absolute hard limit is reached, the system **automatically and forcefully terminates** the call and updates the appointment status to `completed` in the database, without requiring manual doctor intervention.

---

### Rule 8: Completion & Attendance Safeguards
To maintain billing integrity and accurate attendance records:
1. **Dual Attendance Requirement:** A consultation status can **only** be marked as `"completed"` in the database if **both** the doctor and patient actively joined the room (`doctorJoinedAt` and `patientJoinedAt` are both recorded), and the doctor explicitly clicked "End Call" (after the 3-minute lock) or the max extension hard-stop was enforced.
2. **Doctor-Only Conclusion:** Only the doctor can explicitly conclude a consultation. A patient clicking exit merely leaves the room.
3. **Patient Early Disconnect Safeguard:** If the patient leaves early or drops off, the room remains active for the doctor. An early patient departure **never** prematurely finalizes the appointment as completed, allowing the patient to reconnect or the doctor to take appropriate clinical notes.

---

### Rule 9: Active Consultation Re-Join Allowance & Expiry Boundary Rules
To balance patient accessibility against schedule integrity during unexpected network disconnections or temporary room exits:

1. **Conditional Re-Join Allowance:**
   - If a consultation between the doctor and patient has **already successfully started** (whether via Early Start from $\text{ScheduledStartAt} - 7\text{ min}$ or Scheduled Start, recorded via `hasOverlapped = true`, `sessionStartedAt`, or dual attendance `doctorJoinedAt` & `patientJoinedAt`), and the patient accidentally drops, disconnects, refreshes, or leaves the room, the patient **MUST be allowed to re-join** the active ongoing consultation even if the initial `LateJoinGrace` / `LastJoinAt` period has passed.

2. **Access Expiry Boundary (Scheduled End Time):**
   - The patient's re-join button/option remains **active and enabled until the appointment's Scheduled End time** (`ScheduledEndAt`, e.g., for a 9:00 AM – 9:10 AM slot, re-join is permitted up to 9:10 AM, after which access expires).
   - Once the clock reaches or passes `ScheduledEndAt`, the re-join button is permanently disabled/expired, and room access attempts are rejected by the server.

3. **Strict Restrictions (When NOT to Allow Join / Re-Join):**
   - **Un-started Consultations (First Join Past Grace Period):** If the consultation never started (doctor and patient never connected together in the room) and the Late Join Grace / Cutoff period expired (`now >= LateJoinCutoffAt`), the patient must **NOT** be allowed to join. The join button remains disabled/expired, and the backend blocks entry.
   - **Concluded / Completed Consultations:** If the consultation successfully started, progressed, and the doctor officially clicked **"End Call"** (concluding the session according to the 3-minute rule), the consultation status is transitioned to `"completed"`. The patient is **strictly blocked** from re-joining. The UI renders the status as `"Completed"` without a re-join option, and backend signaling rejects room entry.
   - **Terminal / Cancelled States:** Any appointment in a terminal state (`completed`, `no-show`, `cancelled`, `cancelled_by_doctor`, `doctor_missed`, `disputed`, `refunded`) strictly rejects entry for all participants.

---

## Implementation & System Integration Log

All rules defined in this specification have been implemented and validated across the full stack.

### 1. Backend Module Updates (`zydoc-backend`)
| File | Changes & Enforcements |
| :--- | :--- |
| [`src/config/videoCallConfig.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/config/videoCallConfig.js) | Configured `WRAP_UP_COUNTDOWN_SECONDS = 20`, `EARLY_JOIN_MINUTES = 10`, `EARLY_START_MINUTES = 7`, `MIN_CONSULTATION_DURATION_SECONDS = 180`, and `RECONNECTION_GRACE_SECONDS = 30`. |
| [`src/infrastructure/utils/timeUtils.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/infrastructure/utils/timeUtils.js) | Implemented dynamic late join grace $\min(\text{Duration} \times 25\%, 10\text{m})$, last booking cutoff, and 3-state consultation timing (`EARLY`, `ON_TIME`, `LATE`) capping `DurationEndAt` on late start. |
| [`src/modules/video-call/use-cases/JoinRoomUseCase.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/modules/video-call/use-cases/JoinRoomUseCase.js) | Enforced Early Start window ($\ge \text{ScheduledStartAt} - 7\text{m}$), 3-state boundary calculation, active consultation re-join allowance until `ScheduledEndAt`, strict block on unstarted late joins past `LateJoinCutoffAt`, and terminal status locks. |
| [`src/modules/video-call/use-cases/JoinWaitingRoomUseCase.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/modules/video-call/use-cases/JoinWaitingRoomUseCase.js) | Enforced Early Join window ($\ge \text{ScheduledStartAt} - 10\text{m}$) and immediate 20s auto-cut trigger when Patient B goes live while doctor is with Patient A. |
| [`src/modules/video-call/use-cases/ExtendRoomUseCase.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/modules/video-call/use-cases/ExtendRoomUseCase.js) | Guard denying extension if next patient is waiting live. |
| [`src/modules/video-call/use-cases/EndRoomUseCase.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/modules/video-call/use-cases/EndRoomUseCase.js) | Enforced 3-minute consultation lock ($180\text{s}$), doctor-only conclusion authority, dual-attendance validation before DB completion, and transaction updates. |
| [`src/modules/video-call/use-cases/LeaveRoomUseCase.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/modules/video-call/use-cases/LeaveRoomUseCase.js) | Maintained scheduled status for in-progress consultation re-joins prior to Scheduled End Time when participants drop/exit. |
| [`src/modules/video-call/controllers/WebRTCController.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/modules/video-call/controllers/WebRTCController.js) | Implemented 30-second reconnection grace buffer on socket disconnect emitting `peer_temporarily_disconnected` / `peer_reconnected`, and 1-second evaluator for live slot transitions. |
| [`src/infrastructure/repositories/MongoAppointmentRepository.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/infrastructure/repositories/MongoAppointmentRepository.js) | Enforced active consultation re-join allowance in `lazyUpdateNoShows`, preventing premature expiration of started sessions before `slotEndUTC`. |
| [`src/infrastructure/database/models/Appointment.js`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-backend/src/infrastructure/database/models/Appointment.js) | Added call extension tracking fields (`isExtended`, `extensionDeadlineAt`, `extensionConstrainedByNextPatient`) and persisted consultation lifecycle/attendance schema fields (`doctorJoinedAt`, `patientJoinedAt`, `sessionStartedAt`, `sessionEndedAt`, `doctorJoinStatus`, `patientJoinStatus`, `sessionStartStatus`, `hasOverlapped`). |

---

### 2. Frontend Module Updates (`zydoc-frontend`)
| File | Changes & Enforcements |
| :--- | :--- |
| [`src/config/videoCallConfig.ts`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/config/videoCallConfig.ts) | Mirrored backend config constants (`WRAP_UP_COUNTDOWN_SECONDS = 20`, `EARLY_JOIN_MINUTES = 10`, `EARLY_START_MINUTES = 7`, `MIN_CONSULTATION_DURATION_SECONDS = 180`, `RECONNECTION_GRACE_SECONDS = 30`). |
| [`src/modules/video-call/hooks/useCallTimer.ts`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/modules/video-call/hooks/useCallTimer.ts) | Dynamic 3-state timer calculation (`early`, `on_time`, `late`), 20s wrap-up phase, and max extension auto-disconnect handling. |
| [`src/modules/video-call/hooks/usePreventCallExit.ts`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/modules/video-call/hooks/usePreventCallExit.ts) | Blocked browser reload shortcuts (`F5`, `Ctrl+R`, `Cmd+R`, `Ctrl+Shift+R`, `Cmd+Shift+R`) and mobile pull-to-refresh gestures (`overscroll-behavior-y: contain` and touchmove cancel). |
| [`src/modules/video-call/components/CallControls.tsx`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/modules/video-call/components/CallControls.tsx) | Added visual lock icon, countdown badge, and tooltip on End Call button for doctors when active time $< 180\text{s}$. |
| [`src/modules/video-call/components/VideoCallRoom.tsx`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/modules/video-call/components/VideoCallRoom.tsx) | Implemented 3-minute lock blocking modal, 20s auto-cut wrap-up countdown banner, 30s peer reconnection alert banner, and Patient B handover session packaging. |
| [`src/app/patient/(protected)/appointments/page.tsx`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/app/patient/(protected)/appointments/page.tsx) | Implemented Rule 9 evaluation: enabled active "Rejoin Call" button up to `ScheduledEndAt` for started sessions, strictly disabled/expired past cutoff for unstarted sessions, and blocked completed sessions. |
| [`src/app/doctor/(protected)/dashboard/doctor-dashboardClient.tsx`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/app/doctor/(protected)/dashboard/doctor-dashboardClient.tsx) | Implemented high-priority Patient B waiting room entry prompt upon auto-cut redirection, enforcing manual entry per Rule 2.1. |
| [`src/redux/features/consultation/consultationSlice.ts`](file:///c:/Users/ADNAN%20MUHAMMED/OneDrive/Documents/ZydocAppFolder/zydocProjectFolder/zydoc-frontend/src/redux/features/consultation/consultationSlice.ts) | Added `activeSession` state tracking to maintain clinical session metadata across disconnections and component mount cycles. |