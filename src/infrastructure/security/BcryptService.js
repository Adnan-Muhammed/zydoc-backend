import bcrypt from 'bcryptjs';

export class BcryptService {
    async hashPassword(password) {
        const salt = await bcrypt.genSalt(10);
        return await bcrypt.hash(password, salt);
    }

    async comparePassword(candidate, hash) {
        return await bcrypt.compare(candidate, hash);
    }
}
