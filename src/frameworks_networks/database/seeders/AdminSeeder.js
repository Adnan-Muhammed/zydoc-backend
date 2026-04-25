import UserModel from '../models/UserModel.js';
import { BcryptService } from '../../../interface_adapters/security/BcryptService.js';

export const seedAdmin = async () => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminName = process.env.ADMIN_NAME;

        if (!adminEmail || !adminPassword) {
            console.log('Admin seeding skipped: ADMIN_EMAIL or ADMIN_PASSWORD not set in .env');
            return;
        }

        const existingAdmin = await UserModel.findOne({ email: adminEmail });
        if (existingAdmin) {
            console.log('Admin user already exists. Seeding skipped.');
            return;
        }

        console.log(`Seeding Admin: ${adminEmail}`);

        const bcryptService = new BcryptService();
        const hashedPassword = await bcryptService.hashPassword(adminPassword);

        const adminUser = new UserModel({
            name: adminName || 'System Admin',
            email: adminEmail,
            password: hashedPassword,
            role: 'admin',
            isDeleted: false,
            lastLogin: null,
            refreshToken: null
        });

        await adminUser.save();
        console.log(`Admin user created successfully: ${adminEmail}`);

    } catch (error) {
        console.error('Error seeding admin user:', error);
    }
};
