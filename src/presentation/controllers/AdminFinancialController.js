// src/presentation/controllers/AdminFinancialController.js

import Transaction from "../../infrastructure/database/models/Transaction.js";
import WalletTransaction from "../../infrastructure/database/models/WalletTransaction.js";
import Doctor from "../../infrastructure/database/models/DoctorProfile.js";
import SharedUser from "../../infrastructure/database/models/SharedUser.js";

export class AdminFinancialController {
  // ── GET /api/admin/financials/ledger ───────────────────────────────────────
  async getLedger(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 100));
      const { status, search, exportCsv } = req.query;

      const filter = {};
      if (status) {
        filter.status = status.toLowerCase();
      }

      const skip = (page - 1) * limit;

      // Query transactions with full population
      let query = Transaction.find(filter)
        .populate({
          path: "doctorId",
          select: "firstName lastName specialty avatarUrl phone bankDetails",
        })
        .populate({
          path: "patientId",
          select: "email googleName googleAvatarUrl profileId",
          populate: {
            path: "profileId",
            select: "firstName lastName fullName phone avatarUrl",
          },
        })
        .populate({
          path: "appointmentId",
          select: "appointmentDate appointmentTime consultationType status fee",
        })
        .sort({ createdAt: -1 });

      if (!exportCsv) {
        query = query.skip(skip).limit(limit);
      }

      const [transactionsRaw, totalCount, summaryAgg] = await Promise.all([
        query.lean(),
        Transaction.countDocuments(filter),
        Transaction.aggregate([
          {
            $group: {
              _id: null,
              totalVolume: { $sum: "$amount" },
              totalAdminCommission: { $sum: "$adminCommission" },
              totalDoctorPayouts: { $sum: "$doctorAmount" },
              settledCount: {
                $sum: { $cond: [{ $eq: ["$status", "settled"] }, 1, 0] },
              },
              pendingCount: {
                $sum: { $cond: [{ $in: ["$status", ["pending", "completed"]] }, 1, 0] },
              },
            },
          },
        ]),
      ]);

      const formatted = transactionsRaw.map((tx) => {
        const doc = tx.doctorId || {};
        const pat = tx.patientId || {};
        const patProfile = pat.profileId || {};
        const appt = tx.appointmentId || {};

        const docName = doc.firstName
          ? `Dr. ${doc.firstName} ${doc.lastName || ""}`.trim()
          : "Assigned Doctor";

        const patName =
          patProfile.fullName ||
          (patProfile.firstName
            ? `${patProfile.firstName} ${patProfile.lastName || ""}`.trim()
            : pat.email?.split("@")[0] || "Patient");

        return {
          _id: tx._id,
          paymentId: tx.paymentId || "N/A",
          amount: tx.amount || 0,
          adminCommission: tx.adminCommission || 0,
          doctorAmount: tx.doctorAmount || 0,
          status: tx.status || "pending",
          settledAt: tx.settledAt || null,
          createdAt: tx.createdAt,
          doctor: {
            _id: doc._id || null,
            name: docName,
            specialty: doc.specialty || "General Medicine",
            bankDetails: doc.bankDetails || null,
          },
          patient: {
            _id: pat._id || null,
            name: patName,
            email: pat.email || "N/A",
          },
          appointment: {
            _id: appt._id || null,
            date: appt.appointmentDate,
            time: appt.appointmentTime,
            type: appt.consultationType || "online",
            status: appt.status || "completed",
          },
        };
      });

      // Filter by search string in memory if requested
      let resultRows = formatted;
      if (search && search.trim()) {
        const s = search.toLowerCase().trim();
        resultRows = formatted.filter(
          (r) =>
            r.paymentId.toLowerCase().includes(s) ||
            r.doctor.name.toLowerCase().includes(s) ||
            r.patient.name.toLowerCase().includes(s) ||
            r.patient.email.toLowerCase().includes(s)
        );
      }

      const summary = summaryAgg[0] || {
        totalVolume: 0,
        totalAdminCommission: 0,
        totalDoctorPayouts: 0,
        settledCount: 0,
        pendingCount: 0,
      };

      return res.status(200).json({
        success: true,
        transactions: resultRows,
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
        summary,
      });
    } catch (error) {
      console.error("[getLedger] Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch financial ledger records",
        error: error.message,
      });
    }
  }

  // ── POST /api/admin/financials/settle/:id ──────────────────────────────────
  async settlePayout(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user?.id || req.user?._id;

      const transaction = await Transaction.findById(id);
      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found",
        });
      }

      if (transaction.status === "settled") {
        return res.status(400).json({
          success: false,
          message: "Transaction is already settled",
        });
      }

      transaction.status = "settled";
      transaction.settledAt = new Date();
      transaction.settledBy = adminId;
      await transaction.save();

      return res.status(200).json({
        success: true,
        message: "Doctor payout settled successfully",
        transaction,
      });
    } catch (error) {
      console.error("[settlePayout] Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to settle doctor payout",
        error: error.message,
      });
    }
  }
}
