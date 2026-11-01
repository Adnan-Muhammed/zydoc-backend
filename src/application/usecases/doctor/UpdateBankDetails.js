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
    const holder = String(accountHolderName).trim();
    const bank = String(bankName).trim();
    const account = String(accountNumber).trim();
    const ifsc = String(ifscCode).trim().toUpperCase();
    if (!/^\d{6,18}$/.test(account)) throw new Error("Account number must contain 6 to 18 digits");
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error("Enter a valid 11-character IFSC code");
    if (holder.length < 2 || holder.length > 100 || !/[\p{L}\p{M}]/u.test(holder) || !/^[\p{L}\p{M} .’'-]+$/u.test(holder)) throw new Error("Enter a valid account holder name");
    if (bank.length < 2 || bank.length > 100 || !/[\p{L}\p{M}]/u.test(bank) || !/^[\p{L}\p{M}\d .&'()-]+$/u.test(bank)) throw new Error("Enter a valid bank name");

    const updatedBankDetails = await this.userRepository.updateBankDetails(doctorId, {
      accountNumber: account,
      ifscCode: ifsc,
      bankName: bank,
      accountHolderName: holder
    });

    return updatedBankDetails;
  }
}
