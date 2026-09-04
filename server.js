// zydoc-backend/server.js
import "dotenv/config";
import express from "express";
// import dotenv from 'dotenv';
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import http from "http";
import { socketService } from "./src/infrastructure/services/SocketService.js";

// Database
import connectDB from "./src/infrastructure/database/connection.js";

// Routes
import authRoutes from "./src/presentation/routes/authRoutes.js";
import adminAuthRoutes from "./src/presentation/routes/adminAuthRoutes.js";
import userRoutes from "./src/presentation/routes/userRoutes.js";
import adminRoutes from "./src/presentation/routes/adminRoutes.js";
import { seedAdmin } from "./src/infrastructure/database/seeders/AdminSeeder.js";
import doctorRoutes from "./src/presentation/routes/doctorRoutes.js";
import adminDoctorRoutes from "./src/presentation/routes/adminDoctorRoutes.js";
import adminPatientRoutes from "./src/presentation/routes/adminPatientRoutes.js";
import doctorsPublicRoutes from "./src/presentation/routes/doctorsPublicRoutes.js";
import patientRoutes from "./src/presentation/routes/patientRoutes.js";
import appointmentRoutes from "./src/presentation/routes/appointmentRoutes.js";
import notificationRoutes from "./src/presentation/routes/notificationRoutes.js";

// Initialize Cron Jobs
import "./src/infrastructure/cron/SlotCron.js";

// Config
// dotenv.config();
const app = express();
const PORT = process.env.PORT; // Use a different port than existing backend

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// app.use(morgan('dev'));   // it shows what's happening through (logs)
// app.use(helmet()); // Protect the app (security) // cmmented for image appearence from backend to frontend
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
); // Protect the app (security)

// app.use(cors({
//     origin: process.env.CLIENT_URL || 'http://localhost:3000',
//     credentials: true
// }));

const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
};

// Handle CORS preflight (OPTIONS) and all requests with the same cors() config
// This ensures consistent Access-Control-* headers on BOTH preflight and actual requests
// Note: path-to-regexp v6+ does not support bare "*" — use a regex instead
app.options(/\/.*/, cors(corsOptions)); // Preflight handler for all routes
app.use(cors(corsOptions));             // Actual requests

// Debug Middleware
if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {

    // console.log(`[DEBUG] ${req.method} ${req.url} ${res.statusCode}`);
    // console.log('[DEBUG] Auth Header:', req.headers.authorization);
    // console.log('[DEBUG] Cookies:', req.cookies);
    next();
  });
}

// Connect to Database
connectDB().then(() => {
  seedAdmin(); 
});

app.use("/uploads", express.static("uploads"));

// Routes
app.use("/api/auth", authRoutes); // login for patient and doctor in single because shared collection shared doctors,patients
app.use("/api/admin/auth", adminAuthRoutes);  // login for admin





app.use("/api/admin/doctors", adminDoctorRoutes);
app.use("/api/admin/patients", adminPatientRoutes);
app.use("/api/doctor/", 
  ((req, res, next) => { console.log(123456789), next() }),
   doctorRoutes);   // doctor  profile completions



   
app.use("/api/patient/", patientRoutes); // patient profile completions
app.use("/api/appointments", appointmentRoutes); // appointments flow
app.use("/api/notifications", notificationRoutes); // notification system




app.use("/api/doctors", doctorsPublicRoutes);  // doctors public
app.use("/api/user", userRoutes); //  get profile and put profile 













app.use("/api/admin/users", adminRoutes);
app.use("/api/admin", adminRoutes);
// 
// app.use(
//   "/api/admin/doctors",
//   (req, res, next) => {
//     console.log("doc list");
//     console.log("Authorization:", req.headers.authorization);
//     next();
//   },
//   adminDoctorRoutes
// );

app.get("/", (req, res) => {
  res.send("Clean Architecture Backend API is running...");
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

const server = http.createServer(app);

// Initialize Socket.io
socketService.init(server);

server.listen(PORT, () => {
  // console.log(`Server is running on port ${PORT}`);
});
