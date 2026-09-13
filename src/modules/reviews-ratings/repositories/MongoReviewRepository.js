import mongoose from "mongoose";
import Review from "../models/Review.js";
import Doctor from "../../../infrastructure/database/models/DoctorProfile.js";
import Appointment from "../../../infrastructure/database/models/Appointment.js";

export class MongoReviewRepository {
  async create(data) {
    return await Review.create(data);
  }

  async update(reviewId, data) {
    return await Review.findByIdAndUpdate(reviewId, { $set: data }, { new: true });
  }

  async findById(reviewId) {
    return await Review.findById(reviewId);
  }

  async findByAppointmentId(appointmentId) {
    return await Review.findOne({ appointmentId })
      .populate("patientId", "firstName lastName googleName avatarUrl")
      .lean();
  }

  async findByPatientAndAppointment(patientId, appointmentId) {
    return await Review.findOne({ patientId, appointmentId }).lean();
  }

  /**
   * Fetch reviews for a specific doctor with pagination and optional rating filter.
   * Populates patient profile info when review is not anonymous.
   */
  async findByDoctorId(doctorId, { page = 1, limit = 10, ratingFilter = null } = {}) {
    const docObjId = new mongoose.Types.ObjectId(doctorId);
    const query = { doctorId: docObjId };

    if (ratingFilter && Number(ratingFilter) >= 1 && Number(ratingFilter) <= 5) {
      query.rating = Number(ratingFilter);
    }

    const skip = (Math.max(1, page) - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate({
          path: "patientId",
          select: "firstName lastName googleName avatarUrl profileId",
          populate: {
            path: "profileId",
            select: "firstName lastName avatarUrl",
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    // Sanitize anonymous reviews so patient personal info is never exposed
    const sanitizedReviews = reviews.map((rev) => {
      if (rev.isAnonymous) {
        return {
          ...rev,
          patientId: {
            firstName: "Anonymous",
            lastName: "Patient",
            avatarUrl: null,
          },
        };
      }
      return rev;
    });

    return {
      reviews: sanitizedReviews,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Aggregate doctor's average rating and distribution breakdown (1-5 stars)
   */
  async getDoctorRatingBreakdown(doctorId) {
    const docObjId = new mongoose.Types.ObjectId(doctorId);

    const breakdown = await Review.aggregate([
      { $match: { doctorId: docObjId } },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
    ]);

    const starCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalReviews = 0;
    let sumRatings = 0;

    breakdown.forEach((item) => {
      const star = item._id;
      if (starCounts[star] !== undefined) {
        starCounts[star] = item.count;
        totalReviews += item.count;
        sumRatings += star * item.count;
      }
    });

    const averageRating = totalReviews > 0 ? Math.round((sumRatings / totalReviews) * 10) / 10 : 0;

    return {
      averageRating,
      totalReviews,
      starCounts,
      breakdownPercentages: {
        5: totalReviews > 0 ? Math.round((starCounts[5] / totalReviews) * 100) : 0,
        4: totalReviews > 0 ? Math.round((starCounts[4] / totalReviews) * 100) : 0,
        3: totalReviews > 0 ? Math.round((starCounts[3] / totalReviews) * 100) : 0,
        2: totalReviews > 0 ? Math.round((starCounts[2] / totalReviews) * 100) : 0,
        1: totalReviews > 0 ? Math.round((starCounts[1] / totalReviews) * 100) : 0,
      },
    };
  }

  /**
   * Find completed appointments for a patient with a doctor that have NOT yet been reviewed.
   */
  async findEligibleAppointments(patientId, doctorId) {
    const patientObjId = new mongoose.Types.ObjectId(patientId);
    const doctorObjId = new mongoose.Types.ObjectId(doctorId);

    // 1. Get all completed appointments between this patient and doctor
    const completedAppointments = await Appointment.find({
      patientId: patientObjId,
      doctorId: doctorObjId,
      status: "completed",
    })
      .sort({ appointmentDate: -1 })
      .lean();

    if (!completedAppointments.length) {
      return { eligibleAppointments: [], reviewedAppointments: [] };
    }

    const appointmentIds = completedAppointments.map((a) => a._id);

    // 2. Find which appointments already have a review
    const existingReviews = await Review.find({
      appointmentId: { $in: appointmentIds },
    }).lean();

    const reviewedApptIdSet = new Set(existingReviews.map((r) => r.appointmentId.toString()));

    const eligibleAppointments = completedAppointments.filter(
      (a) => !reviewedApptIdSet.has(a._id.toString())
    );

    return {
      eligibleAppointments,
      reviewedAppointments: existingReviews,
    };
  }

  /**
   * Recalculate and update the cached rating and reviewCount in DoctorProfile
   */
  async recalculateDoctorAggregates(doctorId) {
    const docObjId = new mongoose.Types.ObjectId(doctorId);

    const stats = await Review.aggregate([
      { $match: { doctorId: docObjId } },
      {
        $group: {
          _id: "$doctorId",
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    const newRating = stats.length > 0 ? Math.round(stats[0].avgRating * 10) / 10 : 0;
    const newCount = stats.length > 0 ? stats[0].totalReviews : 0;

    await Doctor.findByIdAndUpdate(doctorId, {
      $set: { rating: newRating, reviewCount: newCount },
    });

    return { rating: newRating, reviewCount: newCount };
  }
}
