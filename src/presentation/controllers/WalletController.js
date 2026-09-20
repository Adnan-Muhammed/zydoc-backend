import { MongoWalletRepository } from '../../infrastructure/repositories/MongoWalletRepository.js';
import { GetPatientWalletUseCase } from '../../application/usecases/wallet/GetPatientWalletUseCase.js';

const walletRepository = new MongoWalletRepository();
const getPatientWalletUseCase = new GetPatientWalletUseCase(walletRepository);

export class WalletController {
  constructor(getWalletUseCase = getPatientWalletUseCase) {
    this.getPatientWalletUseCase = getWalletUseCase;
  }

  getWalletDetails = async (req, res) => {
    try {
      const patientId = req.user?.id || req.user?._id;

      if (!patientId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized. Patient ID not found.',
        });
      }

      const { page, limit } = req.query;

      const walletData = await this.getPatientWalletUseCase.execute(patientId, {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 10,
      });

      return res.status(200).json({
        success: true,
        ...walletData,
      });
    } catch (error) {
      console.error('[WalletController.getWalletDetails] Error:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve wallet details',
      });
    }
  };
}

export const walletController = new WalletController();
export const getWalletDetails = walletController.getWalletDetails;
