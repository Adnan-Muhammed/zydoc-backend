export class UpdateUser {
    constructor(userRepository, authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    async execute({ id, name, email, password, isAdmin, adminId }) {
        const user = await this.userRepository.findById(id);

        if (!user) {
            throw new Error('User not found');
        }

        // Prevent admin from removing their own admin privileges
        if (user.id.toString() === adminId && isAdmin === false) {
            throw new Error('Cannot remove admin privileges from your own account');
        }

        if (name) {
            user.name = name.trim();
        }

        if (email) {
            const emailExists = await this.userRepository.findByEmail(email.toLowerCase());
            if (emailExists && emailExists.id.toString() !== id) {
                throw new Error('Email already in use');
            }
            user.email = email.toLowerCase();
        }

        if (password) {
            if (password.length < 6) {
                throw new Error('Password must be at least 6 characters long');
            }
            user.password = await this.authService.hashPassword(password);
        }

        if (isAdmin !== undefined) {
            user.role = isAdmin ? 'admin' : 'user';
        }

        await this.userRepository.update(user);
        return user;
    }
}
