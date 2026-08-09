
// // src/infrastructure/database/seeders/AdminSeeder.js

// import SharedUser from '../models/SharedUser.js';
// import AdminProfile from '../models/AdminProfile.js';
// import { BcryptService } from '../../security/BcryptService.js';

// export const seedAdmin = async () => {
//     try {
//         const adminEmail = process.env.ADMIN_EMAIL;
//         const adminPassword = process.env.ADMIN_PASSWORD;
//         const adminName = process.env.ADMIN_NAME;

//         if (!adminEmail || !adminPassword) {
//             return;
//         }

//         const existingAdmin = await SharedUser.findOne({ email: adminEmail });
//         if (existingAdmin) {
//             return;
//         }


//         const bcryptService = new BcryptService();
//         const hashedPassword = await bcryptService.hashPassword(adminPassword);

//         const adminProfile = new AdminProfile({
//             name: adminName || 'System Admin',
//             permissions: ["full_access"],
//             isSuperAdmin: true,
//             department: "Management"
//         });
//         const savedProfile = await adminProfile.save();

//         const adminUser = new SharedUser({
//             email: adminEmail,
//             password: hashedPassword,
//             role: 'admin',
//             profileId: savedProfile._id,
//             roleModel: 'Admin',
//             isVerified: true
//         });

//         await adminUser.save();

//     } catch (error) {
//         console.error('Error seeding admin user:', error);
//     }
// };






//src/infrastructure/database/seeders/AdminSeeder.js

import SharedUser from '../models/SharedUser.js';
import AdminProfile from '../models/AdminProfile.js';
import { BcryptService } from '../../security/BcryptService.js';

export const seedAdmin = async () => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminName = process.env.ADMIN_NAME;

        // Defensive check: Guard against missing crucial environment variables
        if (!adminEmail || !adminPassword) {
            // console.warn('⚠️ Admin seeding skipped: ADMIN_EMAIL or ADMIN_PASSWORD not specified in environmental variables.');
            //console log commented 
            return;
        }

        // Check if a user with this email already exists
        const existingAdmin = await SharedUser.findOne({ email: adminEmail.toLowerCase().trim() });
        if (existingAdmin) {
            // console.log('ℹ️ Admin user already seeded in database. Skipping initialization.');
            // console log commented 
            return;
        }

        // console.log('🌱 Seeding administrative accounts into clean environment...');
        // console log commented 
        // 1. Instantiate and preserve the AdminProfile document first
        const adminProfile = new AdminProfile({
            name: adminName || 'System Admin',
            department: 'Management',
            accessLevel: 'superadmin' // Matches our updated enum schema configuration ["superadmin", "moderator", "support"]
        });
        const savedProfile = await adminProfile.save();

        // 2. Hash security payload using your custom Bcrypt layer
        const bcryptService = new BcryptService();
        const hashedPassword = await bcryptService.hashPassword(adminPassword);

        // 3. Instantiate the centralized access account pointing dynamically to our profile
        const adminUser = new SharedUser({
            email: adminEmail.toLowerCase().trim(),
            password: hashedPassword,
            role: 'admin',
            profileId: savedProfile._id,
            roleModel: 'Admin',
            isVerified: true,              // Superadmin skips regular OTP registration flows
            isProfileCompleted: true       // 🔥 SOLVED: Directly authorized to enter system tools
        });

        await adminUser.save();
        // console.log(`✅ Success: Administrative authority seeded successfully under account execution [${adminEmail}]`);
        // console log commented 
    } catch (error) {
        console.error('❌ Critical Error executing Admin user seed runner configuration:', error);
    }
};