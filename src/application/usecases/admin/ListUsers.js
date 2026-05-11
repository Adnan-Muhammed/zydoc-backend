export class ListUsers {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }

    async execute({ page = 1, limit = 10, keyword, role, isDeleted }) {
        const query = {};

        if (keyword) {
            query.$or = [
                { name: { $regex: keyword, $options: "i" } },
                { email: { $regex: keyword, $options: "i" } },
            ];
        }

        if (role) {
            query.role = role;
        }

        if (isDeleted) {
            query.isDeleted = isDeleted === 'true';
        }

        const skip = (page - 1) * limit;

        const users = await this.userRepository.find(query, { skip, limit, sort: { createdAt: -1 } });
        const total = await this.userRepository.count(query);

        return {
            users,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit),
            }
        };
    }
}
