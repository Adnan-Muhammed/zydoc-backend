export class UpdateBankDetails {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(doctorId, bankDetails) {
    if (!doctorId) {
      throw new Error("Doctor ID is required");
    }

    if (!bankDetails) {
      throw new Error("Bank details are required");
    }

    const { accountNumber, ifscCode, bankName, accountHolderName } = bankDetails;

    if (!accountNumber || !ifscCode || !bankName || !accountHolderName) {
      throw new Error("All bank details (Account Number, IFSC Code, Bank Name, Account Holder Name) are required");
    }

    const updatedBankDetails = await this.userRepository.updateBankDetails(doctorId, {
      accountNumber: accountNumber.trim(),
      ifscCode: ifscCode.trim().toUpperCase(),
      bankName: bankName.trim(),
      accountHolderName: accountHolderName.trim()
    });

    return updatedBankDetails;
  }
}
