// src/application/usecases/auth/SetRole.js

export class SetRole {
  constructor(userRepository, authService) {
    this.userRepository = userRepository;
    this.authService = authService;
  }
 
  async execute(userId, newRole) {
    if (newRole !== "doctor" && newRole !== "patient") {
      throw new Error("Invalid role provided. Must be 'doctor' or 'patient'.");
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error("User not found.");
    }

    if (user.role !== "unassigned") {
      throw new Error("User already has an assigned role.");
    }

    // Call the repository method to update role and create specific profile
    const updatedUser = await this.userRepository.assignRoleAndCreateProfile(
      userId,
      newRole,
    );

    // Generate new tokens since role has changed
    const accessToken = this.authService.generateAccessToken(updatedUser);
    const refreshToken = this.authService.generateRefreshToken(updatedUser);

    updatedUser.refreshToken = refreshToken;
    await this.userRepository.update(updatedUser);

    return { user: updatedUser, accessToken, refreshToken };
  }
}
