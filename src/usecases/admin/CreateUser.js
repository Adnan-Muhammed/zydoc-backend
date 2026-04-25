export class CreateUser {
    constructor(userRepository, authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    async execute({ name, email, password, isAdmin, createdBy }) {
        if (!name || !email || !password) {
            throw new Error('Name, email, and password are required');
        }

        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters long');
        }

        const existingUser = await this.userRepository.findByEmail(email.toLowerCase());
        if (existingUser) {
            throw new Error('User with this email already exists');
        }

        const hashedPassword = await this.authService.hashPassword(password);

        const newUser = {
            name: name.trim(),
            email: email.toLowerCase(),
            password: hashedPassword,
            role: isAdmin ? 'admin' : 'user',
            isDeleted: false,
            lastLogin: null,
            refreshToken: null,
            createdBy
        };

        return await this.userRepository.create(newUser);
    }
}
