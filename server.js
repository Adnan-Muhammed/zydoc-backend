
// zydoc-backend/server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';

// Database
import connectDB from './src/infrastructure/database/connection.js';

// Routes
import authRoutes from './src/presentation/routes/authRoutes.js';
import adminAuthRoutes from './src/presentation/routes/adminAuthRoutes.js';
import userRoutes from './src/presentation/routes/userRoutes.js';
import adminRoutes from './src/presentation/routes/adminRoutes.js';
import { seedAdmin } from './src/infrastructure/database/seeders/AdminSeeder.js';

// Config
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5001; // Use a different port than existing backend

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));   // it shows what's happening through (logs)
app.use(helmet());        // Protect the app (security)

// app.use(cors({
//     origin: process.env.CLIENT_URL || 'http://localhost:3000',
//     credentials: true
// }));

app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));


// Debug Middleware
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        console.log(`[DEBUG] ${req.method} ${req.url} ${res.statusCode}`);
        // console.log('[DEBUG] Auth Header:', req.headers.authorization);
        // console.log('[DEBUG] Cookies:', req.cookies);
        next();
    });
}

// Connect to Database
connectDB().then(() => {
    seedAdmin();
});



// Routes
app.use('/api/auth', authRoutes);

console.log(1111);


app.use('/api/admin/auth', adminAuthRoutes);

app.use('/api/user', userRoutes);
app.use('/api/admin/users', adminRoutes);

app.get('/', (req, res) => {
    res.send('Clean Architecture Backend API is running...');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error'
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
