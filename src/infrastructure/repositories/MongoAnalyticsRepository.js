// src/infrastructure/repositories/MongoAnalyticsRepository.js

import mongoose from "mongoose";
import { AnalyticsRepository } from "../../domain/repositories/AnalyticsRepository.js";
import Appointment from "../database/models/Appointment.js";
import SharedUser from "../database/models/SharedUser.js";
import Doctor from "../database/models/DoctorProfile.js";
import Patient from "../database/models/PatientProfile.js";

export class MongoAnalyticsRepository extends AnalyticsRepository {
  /**
   * Return high-level KPI metrics for the Admin Dashboard.
   *
   * Metrics:
   * 1. Total active doctors
   * 2. Total registered patients
   * 3. Total platform revenue (admin commission earned)
   * 4. Count of today's appointments
   */
  async getSummaryStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [
      activeDoctorsCount,
      totalDoctorsCount,
      totalPatientsCount,
      activePatientsCount,
      revenueAggregation,
      todayAppointmentsAggregation,
      overallAppointmentCounts,
    ] = await Promise.all([
      // 1. Doctors
      SharedUser.countDocuments({ role: "doctor", accountStatus: "active" }),
      SharedUser.countDocuments({ role: "doctor" }),

      // 2. Patients
      SharedUser.countDocuments({ role: "patient" }),
      SharedUser.countDocuments({ role: "patient", accountStatus: "active" }),

      // 3. Platform Revenue Aggregation (completed / paid appointments)
      Appointment.aggregate([
        {
          $match: {
            status: { $nin: ["cancelled", "cancelled_by_doctor", "refunded", "expired", "available"] },
            paymentStatus: { $in: ["paid", "direct"] },
          },
        },
        {
          $group: {
            _id: null,
            totalGrossVolume: { $sum: "$fee" },
            totalPlatformRevenue: { $sum: { $ifNull: ["$adminCommission", 0] } },
            totalDoctorPayouts: {
              $sum: {
                $ifNull: [
                  "$doctorAmount",
                  { $subtract: ["$fee", { $ifNull: ["$adminCommission", 0] }] },
                ],
              },
            },
            paidAppointmentsCount: { $sum: 1 },
          },
        },
      ]),

      // 4. Today's Appointments Aggregation
      Appointment.aggregate([
        {
          $match: {
            appointmentDate: { $gte: startOfToday, $lte: endOfToday },
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),

      // Overall Appointment status counters
      Appointment.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Format Platform Revenue
    const revenue = revenueAggregation[0] || {
      totalGrossVolume: 0,
      totalPlatformRevenue: 0,
      totalDoctorPayouts: 0,
      paidAppointmentsCount: 0,
    };

    // Format Today's Appointments breakdown
    let todayTotal = 0;
    let todayCompleted = 0;
    let todayOngoing = 0;
    let todayScheduled = 0;
    let todayCancelled = 0;

    todayAppointmentsAggregation.forEach((item) => {
      todayTotal += item.count;
      const s = (item._id || "").toLowerCase();
      if (s === "completed") todayCompleted += item.count;
      else if (s === "in_progress" || s === "ongoing") todayOngoing += item.count;
      else if (s === "scheduled") todayScheduled += item.count;
      else if (s.includes("cancel")) todayCancelled += item.count;
    });

    // Format overall appointment metrics
    const overallMap = {};
    overallAppointmentCounts.forEach((item) => {
      overallMap[item._id] = item.count;
    });

    return {
      activeDoctors: activeDoctorsCount,
      totalDoctors: totalDoctorsCount,
      registeredPatients: totalPatientsCount,
      activePatients: activePatientsCount,
      totalPlatformRevenue: revenue.totalPlatformRevenue,
      totalGrossVolume: revenue.totalGrossVolume,
      totalDoctorPayouts: revenue.totalDoctorPayouts,
      paidAppointmentsCount: revenue.paidAppointmentsCount,
      todayAppointments: {
        total: todayTotal,
        completed: todayCompleted,
        ongoing: todayOngoing,
        scheduled: todayScheduled,
        cancelled: todayCancelled,
      },
      overallMetrics: {
        completed: overallMap["completed"] || 0,
        scheduled: overallMap["scheduled"] || 0,
        refunded: overallMap["refunded"] || 0,
        cancelled: (overallMap["cancelled"] || 0) + (overallMap["cancelled_by_doctor"] || 0),
      },
    };
  }

  /**
   * Aggregate completed/paid appointments into a time-series dataset.
   * Compares Admin Commission vs. Doctor Payout.
   *
   * @param {Object} params
   * @param {string} [params.timeframe='daily'] - 'daily' | 'weekly' | 'monthly'
   * @param {number} [params.days=30]           - Number of historical days for daily
   * @param {number} [params.months=12]         - Number of historical months for monthly
   * @param {string} [params.startDate]         - Optional custom ISO start date
   * @param {string} [params.endDate]           - Optional custom ISO end date
   */
  async getRevenueChartData({
    timeframe = "daily",
    days = 30,
    months = 12,
    startDate,
    endDate,
  } = {}) {
    let dateFormat = "%Y-%m-%d";
    let fromDate = null;
    const toDate = endDate ? new Date(endDate) : new Date();

    if (startDate) {
      fromDate = new Date(startDate);
    } else if (timeframe === "monthly") {
      dateFormat = "%Y-%m";
      fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - (months || 12));
      fromDate.setDate(1);
      fromDate.setHours(0, 0, 0, 0);
    } else if (timeframe === "weekly") {
      dateFormat = "%Y-W%V";
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7 * 12); // Last 12 weeks
      fromDate.setHours(0, 0, 0, 0);
    } else {
      // Daily
      dateFormat = "%Y-%m-%d";
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - (Number(days) || 30));
      fromDate.setHours(0, 0, 0, 0);
    }

    const matchStage = {
      status: { $nin: ["cancelled", "cancelled_by_doctor", "refunded", "expired", "available"] },
      paymentStatus: { $in: ["paid", "direct"] },
    };

    if (fromDate) {
      matchStage.appointmentDate = { $gte: fromDate, $lte: toDate };
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: {
              format: dateFormat,
              date: "$appointmentDate",
            },
          },
          totalRevenue: { $sum: "$fee" },
          adminCommission: { $sum: { $ifNull: ["$adminCommission", 0] } },
          doctorPayout: {
            $sum: {
              $ifNull: [
                "$doctorAmount",
                { $subtract: ["$fee", { $ifNull: ["$adminCommission", 0] }] },
              ],
            },
          },
          appointmentCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          totalRevenue: 1,
          adminCommission: 1,
          doctorPayout: 1,
          appointmentCount: 1,
        },
      },
    ];

    const results = await Appointment.aggregate(pipeline);

    // Compute totals for summary box
    let totalRevenueSum = 0;
    let totalCommissionSum = 0;
    let totalDoctorPayoutSum = 0;
    let totalAppointmentsSum = 0;

    results.forEach((row) => {
      totalRevenueSum += row.totalRevenue || 0;
      totalCommissionSum += row.adminCommission || 0;
      totalDoctorPayoutSum += row.doctorPayout || 0;
      totalAppointmentsSum += row.appointmentCount || 0;
    });

    return {
      timeframe,
      range: {
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate.toISOString(),
      },
      summary: {
        totalRevenue: totalRevenueSum,
        adminCommission: totalCommissionSum,
        doctorPayout: totalDoctorPayoutSum,
        appointmentsCount: totalAppointmentsSum,
      },
      chartData: results,
    };
  }

  /**
   * Find top 5 performing doctors based on completed consultations and gross earnings.
   *
   * @param {Object} options
   * @param {number} [options.limit=5] - Number of top doctors to return
   */
  async getTopDoctors({ limit = 5 } = {}) {
    const numLimit = Math.max(1, Math.min(Number(limit) || 5, 20));

    // Pipeline: aggregate completed consultations grouped by doctorId
    const aggregationPipeline = [
      {
        $match: {
          status: "completed",
        },
      },
      {
        $group: {
          _id: "$doctorId",
          completedConsultations: { $sum: 1 },
          totalRevenueGenerated: { $sum: "$fee" },
          doctorEarnings: {
            $sum: {
              $ifNull: [
                "$doctorAmount",
                { $subtract: ["$fee", { $ifNull: ["$adminCommission", 0] }] },
              ],
            },
          },
          adminCommissionGenerated: {
            $sum: { $ifNull: ["$adminCommission", 0] },
          },
        },
      },
      {
        $sort: {
          completedConsultations: -1,
          totalRevenueGenerated: -1,
        },
      },
      { $limit: numLimit },
      {
        $lookup: {
          from: "doctors",
          localField: "_id",
          foreignField: "_id",
          as: "doctorProfile",
        },
      },
      { $unwind: { path: "$doctorProfile", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "sharedusers",
          localField: "doctorProfile._id",
          foreignField: "profileId",
          as: "doctorUser",
        },
      },
      { $unwind: { path: "$doctorUser", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          doctorId: "$_id",
          userId: "$doctorUser._id",
          firstName: "$doctorProfile.firstName",
          lastName: "$doctorProfile.lastName",
          name: {
            $trim: {
              input: {
                $concat: [
                  "Dr. ",
                  { $ifNull: ["$doctorProfile.firstName", ""] },
                  " ",
                  { $ifNull: ["$doctorProfile.lastName", ""] },
                ],
              },
            },
          },
          specialty: { $ifNull: ["$doctorProfile.specialty", "General Medicine"] },
          email: { $ifNull: ["$doctorUser.email", "N/A"] },
          phone: { $ifNull: ["$doctorProfile.phone", "N/A"] },
          avatarUrl: { $ifNull: ["$doctorProfile.avatarUrl", ""] },
          rating: { $ifNull: ["$doctorProfile.rating", 5.0] },
          reviewCount: { $ifNull: ["$doctorProfile.reviewCount", 0] },
          accountStatus: { $ifNull: ["$doctorUser.accountStatus", "active"] },
          completedConsultations: 1,
          totalRevenueGenerated: 1,
          doctorEarnings: 1,
          adminCommissionGenerated: 1,
        },
      },
    ];

    const topDoctors = await Appointment.aggregate(aggregationPipeline);

    // Fallback: If platform has fewer than `limit` doctors with completed appointments,
    // fill remaining list from approved doctors so the admin dashboard doesn't appear empty.
    if (topDoctors.length < numLimit) {
      const existingDoctorIds = topDoctors
        .map((d) => d.doctorId)
        .filter(Boolean);

      const remainingSlots = numLimit - topDoctors.length;

      const fallbackDoctors = await Doctor.find({
        _id: { $nin: existingDoctorIds },
        verificationStatus: "approved",
      })
        .limit(remainingSlots)
        .lean();

      for (const doc of fallbackDoctors) {
        const user = await SharedUser.findOne({ profileId: doc._id }).lean();
        topDoctors.push({
          doctorId: doc._id,
          userId: user?._id || null,
          firstName: doc.firstName,
          lastName: doc.lastName,
          name: `Dr. ${doc.firstName || ''} ${doc.lastName || ''}`.trim(),
          specialty: doc.specialty || "General Medicine",
          email: user?.email || "N/A",
          phone: doc.phone || "N/A",
          avatarUrl: doc.avatarUrl || "",
          rating: doc.rating || 5.0,
          reviewCount: doc.reviewCount || 0,
          accountStatus: user?.accountStatus || "active",
          completedConsultations: 0,
          totalRevenueGenerated: 0,
          doctorEarnings: 0,
          adminCommissionGenerated: 0,
        });
      }
    }

    return topDoctors;
  }

  /**
   * Return comprehensive clinical intelligence aggregations for Healthcare Analytics
   * Calculates time series, channel breakdowns, specialty performance, doctor utilization,
   * patient retention, and cancellation root cause distributions from real MongoDB collections.
   *
   * @param {Object} options
   * @param {string} [options.range='30d'] - '7d' | '30d' | '90d' | '1y'
   */
  async getClinicalAnalyticsData({ range = "30d" } = {}) {
    const now = new Date();
    let startDate = new Date();

    if (range === "7d") {
      startDate.setDate(now.getDate() - 7);
    } else if (range === "90d") {
      startDate.setDate(now.getDate() - 90);
    } else if (range === "1y") {
      startDate.setFullYear(now.getFullYear() - 1);
    } else {
      // 30d default
      startDate.setDate(now.getDate() - 30);
    }
    startDate.setHours(0, 0, 0, 0);

    // 1. Fetch appointments within window
    const [appointments, activeDoctorsCount] = await Promise.all([
      Appointment.find({
        appointmentDate: { $gte: startDate, $lte: now },
      })
        .populate({
          path: "doctorId",
          select: "firstName lastName specialty rating",
        })
        .populate({
          path: "patientId",
          select: "email profileId",
        })
        .lean(),
      SharedUser.countDocuments({
        role: "doctor",
        accountStatus: "active",
      }),
    ]);

    // 2. Build time-series buckets
    const bucketsMap = new Map();
    if (range === "7d") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-US", { weekday: "short" });
        bucketsMap.set(key, {
          label,
          videoConsultations: 0,
          clinicVisits: 0,
          cancellations: 0,
          grossRevenue: 0,
          platformCommission: 0,
          activeUsersSet: new Set(),
        });
      }
    } else if (range === "30d") {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        bucketsMap.set(key, {
          label,
          videoConsultations: 0,
          clinicVisits: 0,
          cancellations: 0,
          grossRevenue: 0,
          platformCommission: 0,
          activeUsersSet: new Set(),
        });
      }
    } else if (range === "90d") {
      // 12 weeks
      for (let i = 11; i >= 0; i--) {
        const key = `W${12 - i}`;
        const label = `Week ${12 - i}`;
        bucketsMap.set(key, {
          label,
          videoConsultations: 0,
          clinicVisits: 0,
          cancellations: 0,
          grossRevenue: 0,
          platformCommission: 0,
          activeUsersSet: new Set(),
        });
      }
    } else {
      // 1y: 12 months
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleDateString("en-US", { month: "short" });
        bucketsMap.set(key, {
          label,
          videoConsultations: 0,
          clinicVisits: 0,
          cancellations: 0,
          grossRevenue: 0,
          platformCommission: 0,
          activeUsersSet: new Set(),
        });
      }
    }

    // Accumulators
    let onlineRev = 0;
    let clinicRev = 0;
    let onlineCount = 0;
    let clinicCount = 0;
    const specialtyMap = new Map();
    const doctorMap = new Map();
    const patientAppointmentsCount = new Map();

    const cancellationReasonsMap = {
      "Patient Cancelled": 0,
      "Doctor Cancelled / Missed": 0,
      "Patient No-Show": 0,
      "Refunded / Disputed": 0,
    };
    let totalCancelledCount = 0;

    appointments.forEach((appt) => {
      const apptDate = new Date(appt.appointmentDate);
      const isOnline = ["online", "video"].includes(appt.consultationType);
      const isClinic = ["offline", "physical"].includes(appt.consultationType);
      const fee = Number(appt.fee) || 0;
      const commission = Number(appt.adminCommission) || 0;
      const status = (appt.status || "").toLowerCase();
      const isCancelled =
        status.includes("cancel") ||
        ["no-show", "doctor_missed", "disputed", "refunded"].includes(status);

      // Bucket key
      let bKey;
      if (range === "7d" || range === "30d") {
        bKey = apptDate.toISOString().slice(0, 10);
      } else if (range === "90d") {
        const diffWeeks = Math.floor((now.getTime() - apptDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
        const weekNum = Math.max(1, 12 - diffWeeks);
        bKey = `W${weekNum}`;
      } else {
        bKey = `${apptDate.getFullYear()}-${String(apptDate.getMonth() + 1).padStart(2, "0")}`;
      }

      const bucket = bucketsMap.get(bKey);
      if (bucket) {
        if (isCancelled) {
          bucket.cancellations += 1;
        } else if (isOnline) {
          bucket.videoConsultations += 1;
          bucket.grossRevenue += fee;
          bucket.platformCommission += commission;
        } else if (isClinic) {
          bucket.clinicVisits += 1;
          bucket.grossRevenue += fee;
          bucket.platformCommission += commission;
        }
        if (appt.patientId) bucket.activeUsersSet.add(String(appt.patientId._id || appt.patientId));
        if (appt.doctorId) bucket.activeUsersSet.add(String(appt.doctorId._id || appt.doctorId));
      }

      // Channels
      if (!isCancelled) {
        if (isOnline) {
          onlineCount += 1;
          onlineRev += fee;
        } else if (isClinic) {
          clinicCount += 1;
          clinicRev += fee;
        }
      }

      // Specialties
      const doc = appt.doctorId;
      const specialty = doc?.specialty || "General Medicine";
      if (!specialtyMap.has(specialty)) {
        specialtyMap.set(specialty, { consultationsCount: 0, totalRevenue: 0 });
      }
      const specObj = specialtyMap.get(specialty);
      specObj.consultationsCount += 1;
      if (!isCancelled) specObj.totalRevenue += fee;

      // Doctor utilization
      if (doc && doc._id) {
        const dId = String(doc._id);
        const dName = `Dr. ${doc.firstName || ""} ${doc.lastName || ""}`.trim();
        if (!doctorMap.has(dId)) {
          doctorMap.set(dId, {
            name: dName,
            specialty,
            completed: 0,
            total: 0,
            rating: doc.rating || 5.0,
          });
        }
        const dObj = doctorMap.get(dId);
        dObj.total += 1;
        if (status === "completed") dObj.completed += 1;
      }

      // Patient cohort
      const patId = String(appt.patientId?._id || appt.patientId || "");
      if (patId) {
        patientAppointmentsCount.set(patId, (patientAppointmentsCount.get(patId) || 0) + 1);
      }

      // Cancellation reasons
      if (isCancelled) {
        totalCancelledCount += 1;
        if (status === "cancelled") cancellationReasonsMap["Patient Cancelled"] += 1;
        else if (status === "cancelled_by_doctor" || status === "doctor_missed")
          cancellationReasonsMap["Doctor Cancelled / Missed"] += 1;
        else if (status === "no-show") cancellationReasonsMap["Patient No-Show"] += 1;
        else cancellationReasonsMap["Refunded / Disputed"] += 1;
      }
    });

    // Time-series array
    const timeSeries = Array.from(bucketsMap.values()).map((b) => ({
      label: b.label,
      videoConsultations: b.videoConsultations,
      clinicVisits: b.clinicVisits,
      cancellations: b.cancellations,
      grossRevenue: b.grossRevenue,
      platformCommission: b.platformCommission,
      activeUsers: b.activeUsersSet.size,
    }));

    // Channel breakdown
    const totalChannelCount = onlineCount + clinicCount;
    const channelBreakdown = {
      onlineRevenue: onlineRev,
      clinicRevenue: clinicRev,
      onlinePercentage: totalChannelCount > 0 ? Math.round((onlineCount / totalChannelCount) * 100) : 50,
      clinicPercentage: totalChannelCount > 0 ? Math.round((clinicCount / totalChannelCount) * 100) : 50,
    };

    // Specialty performance
    const totalConsultsAll = appointments.length || 1;
    const specialtyPerformance = Array.from(specialtyMap.entries())
      .map(([spec, data]) => ({
        specialty: spec,
        consultationsCount: data.consultationsCount,
        totalRevenue: data.totalRevenue,
        utilizationRate: Math.round((data.consultationsCount / totalConsultsAll) * 100),
      }))
      .sort((a, b) => b.consultationsCount - a.consultationsCount)
      .slice(0, 8);

    // If no specialty history yet, load registered doctor specialties
    if (specialtyPerformance.length === 0) {
      const docs = await Doctor.find({ verificationStatus: "approved" }).limit(5).lean();
      docs.forEach((d) => {
        specialtyPerformance.push({
          specialty: d.specialty || "General Medicine",
          consultationsCount: 0,
          totalRevenue: 0,
          utilizationRate: 0,
        });
      });
    }

    // Doctor utilization
    const doctorsList = Array.from(doctorMap.values())
      .map((d) => ({
        name: d.name,
        specialty: d.specialty,
        rate: d.total > 0 ? Math.min(100, Math.round((d.completed / d.total) * 100)) : 0,
        completed: d.completed,
      }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 4);

    if (doctorsList.length === 0) {
      const approvedDocs = await Doctor.find({ verificationStatus: "approved" }).limit(4).lean();
      approvedDocs.forEach((d) => {
        doctorsList.push({
          name: `Dr. ${d.firstName || ""} ${d.lastName || ""}`.trim(),
          specialty: d.specialty || "General Practice",
          rate: 0,
          completed: 0,
        });
      });
    }

    const overallUtilizationRate =
      doctorsList.length > 0
        ? Math.round(doctorsList.reduce((acc, curr) => acc + curr.rate, 0) / doctorsList.length)
        : 0;

    // Patient retention
    let newPatients = 0;
    let returningPatients = 0;
    patientAppointmentsCount.forEach((cnt) => {
      if (cnt === 1) newPatients += 1;
      else if (cnt > 1) returningPatients += 1;
    });

    const totalUniquePatients = newPatients + returningPatients;
    const repeatConsultationRate =
      totalUniquePatients > 0 ? Math.round((returningPatients / totalUniquePatients) * 100) : 0;
    const retentionRate =
      totalUniquePatients > 0
        ? Math.round(((totalUniquePatients - newPatients * 0.2) / totalUniquePatients) * 100)
        : 0;

    // Cancellation analysis
    const totalApptsCount = appointments.length;
    const cancellationRate =
      totalApptsCount > 0 ? Math.round((totalCancelledCount / totalApptsCount) * 100) : 0;

    const reasonsBreakdown = Object.entries(cancellationReasonsMap).map(([reason, count]) => ({
      reason,
      count,
      percentage: totalCancelledCount > 0 ? Math.round((count / totalCancelledCount) * 100) : 0,
    }));

    return {
      range,
      timeSeries,
      channelBreakdown,
      specialtyPerformance,
      doctorUtilization: {
        overallRate: overallUtilizationRate,
        topUtilizedDoctors: doctorsList,
      },
      patientRetention: {
        newPatients,
        returningPatients,
        repeatConsultationRate,
        retentionRate,
      },
      cancellationAnalysis: {
        totalCancelled: totalCancelledCount,
        cancellationRate,
        reasonsBreakdown,
      },
      overviewStats: {
        activeDoctors: activeDoctorsCount,
        totalConsultations: appointments.length,
      },
    };
  }
}
