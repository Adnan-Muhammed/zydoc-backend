export class AdminController {
    constructor(getAllTransactionsUseCase, settleDoctorPayoutUseCase) {
        this.getAllTransactionsUseCase = getAllTransactionsUseCase;
        this.settleDoctorPayoutUseCase = settleDoctorPayoutUseCase;
    }

    async getTransactions(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 10;

            const result = await this.getAllTransactionsUseCase.execute({ page, limit });

            return res.status(200).json({
                success: true,
                ...result
            });
        } catch (error) {
            console.error("[AdminController] Error fetching transactions:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to fetch transactions"
            });
        }
    }

    async settleTransaction(req, res) {
        try {
            const transactionId = req.params.id;
            if (!transactionId) {
                return res.status(400).json({
                    success: false,
                    message: "Transaction ID is required"
                });
            }

            const updatedTransaction = await this.settleDoctorPayoutUseCase.execute(transactionId);

            return res.status(200).json({
                success: true,
                message: "Payout settled successfully",
                transaction: updatedTransaction
            });
        } catch (error) {
            console.error("[AdminController] Error settling transaction:", error);
            return res.status(400).json({
                success: false,
                message: error.message || "Failed to settle transaction"
            });
        }
    }
}
