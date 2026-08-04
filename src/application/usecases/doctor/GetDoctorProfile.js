export class GetDoctorProfile {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }

    async execute(userId) {
        const profile = await this.userRepository.getAdminDoctorById(userId);
        if (!profile) {
            throw new Error('Doctor profile not found');
        }
        return profile;
    }
}
