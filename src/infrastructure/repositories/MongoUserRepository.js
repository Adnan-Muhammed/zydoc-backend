
// src/infrastructure/repositories/MongoUserRepository.js 

import { UserRepository } from "../../domain/repositories/UserRepository.js";
import { User } from "../../domain/entities/User.js";
import SharedUser from "../database/models/SharedUser.js";
import Doctor from "../database/models/DoctorProfile.js";
import Patient from "../database/models/PatientProfile.js";
import Admin from "../database/models/AdminProfile.js";

export class MongoUserRepository extends UserRepository {
  _getModel(role) {
    const models = {
      doctor: Doctor,
      patient: Patient,
      admin: Admin,
    };
    return models[role.toLowerCase()];
  }

  async createWithProfile(userEntity) {
    try {
      const roleLower = userEntity.role.toLowerCase();
      const ProfileModel = this._getModel(roleLower);

      // 1. Process optional name field. If missing, drop down to use email username handle
      let derivedRawName = userEntity.name ? userEntity.name.trim() : "";
      if (!derivedRawName && userEntity.email) {
        derivedRawName = userEntity.email.split("@")[0];
      }

      // 2. Map structural keys across divided target layouts
      let profileData = {};
      if (roleLower === "doctor" || roleLower === "patient") {
        const nameParts = derivedRawName.split(/\s+/); // Splits cleanly across spacing blocks
        profileData = {
          firstName: nameParts[0] || "Pending",
          // Default to 'Onboarding' fallback since the front-end registration form skips last name values
          lastName: nameParts.slice(1).join(" ") || "Onboarding",
        };
      } else {
        profileData = { name: derivedRawName || "System Admin" };
      }

      // 3. Persist the decoupled specialized structural profile entry
      const profile = await ProfileModel.create(profileData);

      // 🔥 GATEKEEPER CALCULATIONS: Administrative roles are verified instantly on database instantiation
      const isProfileCompleted = roleLower === "admin";

      // 4. Assemble and preserve your centralized secure access identity record
      const sharedUser = await SharedUser.create({
        email: userEntity.email,
        password: userEntity.password,
        role: userEntity.role,
        profileId: profile._id,
        roleModel:
          userEntity.role.charAt(0).toUpperCase() + userEntity.role.slice(1),
        otp: userEntity.otp,
        isVerified: userEntity.isVerified,
        isProfileCompleted: isProfileCompleted,
      });

      return this._toEntity(sharedUser, profile);
    } catch (error) {
      throw error;
    }
  }

  async findByEmail(email) {
    const user = await SharedUser.findOne({ email })
      .select("+password +refreshToken +otp.code +otp.expiresAt")
      .populate("profileId");

    return user ? this._toEntity(user) : null;
  }

  async findById(id) {
    const user = await SharedUser.findById(id)
      .select("+password +refreshToken")
      .populate("profileId");

    return user ? this._toEntity(user) : null;
  }

  async update(userEntity) {
    // Sync configuration variables down to your active authentication record layer
    await SharedUser.findByIdAndUpdate(userEntity.id, {
      email: userEntity.email,
      password: userEntity.password,
      refreshToken: userEntity.refreshToken,
      lastLogin: userEntity.lastLogin,
      "otp.code": userEntity.otp?.code,
      "otp.expiresAt": userEntity.otp?.expiresAt,
      isVerified: userEntity.isVerified,
      isProfileCompleted: userEntity.isProfileCompleted, // Preserves validation toggles
    });

    // Parse runtime structural edits targeting base entities safely
    if (userEntity.name) {
      const roleLower = userEntity.role.toLowerCase();
      const ProfileModel = this._getModel(roleLower);
      const userDoc = await SharedUser.findById(userEntity.id);

      let profileUpdateData = {};
      if (roleLower === "doctor" || roleLower === "patient") {
        const nameParts = userEntity.name.trim().split(/\s+/);
        profileUpdateData = {
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(" ") || "Onboarding",
        };
      } else {
        profileUpdateData = { name: userEntity.name };
      }

      await ProfileModel.findByIdAndUpdate(
        userDoc.profileId,
        profileUpdateData,
      );
    }
  }

  async updateOtp(userId, code, expiresAt) {
    return await SharedUser.findByIdAndUpdate(
      userId,
      {
        "otp.code": code,
        "otp.expiresAt": expiresAt,
      },
      { new: true },
    );
  }





  async updateDoctorProfile(userId, updateData) {
    try {
      const user = await SharedUser.findById(userId);
      if (!user) throw new Error("User not found");
      if (user.role !== "doctor") throw new Error("User is not a doctor");

      const updatedProfile = await Doctor.findByIdAndUpdate(
        user.profileId,
        updateData,
        {
          returnDocument: "after",
          runValidators: true   // Added runValidators
        },
      );

      user.isProfileCompleted =
        updateData.profileCompleted ?? user.isProfileCompleted;
      await user.save();

      return this._toEntity(user, updatedProfile);

    } catch (error) {
      // MongoDB duplicate key error code is 11000
      if (error.code === 11000 && error.keyValue) {
        const duplicateField = Object.keys(error.keyValue)[0];

        if (duplicateField === 'phone') {
          throw new Error("The phone number you provided is already linked to another doctor profile.");
        }
        if (duplicateField === 'licenseNumber') {
          throw new Error("The medical license number you entered is already registered in our system.");
        }

        // throw new Error(`A duplicate value was found for field: ${duplicateField}`);
      }

      // Pass any other errors through
      throw error;
    }

  }

  /**
   * Data Mapper Strategy: Converts DB Documents to explicit Domain Entities
   */
  _toEntity(sharedDoc, profileDoc = null) {
    const profile = profileDoc || sharedDoc.profileId;
    const roleLower = sharedDoc.role.toLowerCase();

    // Harmonize split property variables into standard space-separated display strings
    let computedNameString = "";
    if (profile) {
      if (roleLower === "doctor" || roleLower === "patient") {
        computedNameString =
          `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
      } else {
        computedNameString = profile.name || "";
      }
    }

    const entity = new User(
      sharedDoc._id,
      computedNameString,
      sharedDoc.email,
      sharedDoc.password,
      sharedDoc.role,
      sharedDoc.isDeleted,
      sharedDoc.refreshToken,
      sharedDoc.lastLogin,
    );

    // Bind transient session verification tracking flags down onto entity domain contexts
    entity.otp = sharedDoc.otp;
    entity.isVerified = sharedDoc.isVerified;
    entity.isProfileCompleted = sharedDoc.isProfileCompleted; // Exposes active status parameters up to domain use cases
    entity.verificationStatus = profile?.verificationStatus || "pending"; // Admin approval flag for doctors
    entity.profileId = profile?._id;
    entity.createdAt = sharedDoc.createdAt;
    entity.updatedAt = sharedDoc.updatedAt;

    return entity;
  }

  async count(query = {}) {
    return await SharedUser.countDocuments(query);
  }

  async find(query = {}, options = {}) {
    const { skip = 0, limit = 10, sort = { createdAt: -1 } } = options;
    const users = await SharedUser.find(query)
      .populate("profileId")
      .sort(sort)
      .skip(skip)
      .limit(limit);

    return users.map((user) => this._toEntity(user));
  }

  async getDoctors() {
    const users = await SharedUser.find({ role: "doctor" }).populate(
      "profileId",
    );
    return users.map((user) => this._toEntity(user));
  }



  async getApprovedDoctors() {
    // 1. Query all users with role 'doctor'
    // 2. Populate their profile, BUT ONLY if verificationStatus is 'approved'
    const users = await SharedUser.find({ role: "doctor" }).populate({
      path: "profileId",
      match: { verificationStatus: "approved" }
    });

    // 3. Filter out any users whose profileId became null because they failed the match condition
    const approvedUsers = users.filter(user => user.profileId !== null);

    // 4. Map them using _toEntity normally

    // return approvedUsers.map(user => this._toEntity(user));
    return approvedUsers.map(user => ({
    id: user._id,
    name: `${user.profileId.firstName} ${user.profileId.lastName}`,
    email: user.email,
    avatarUrl: user.profileId.avatarUrl,
    specialty: user.profileId.specialty,
    rating: user.profileId.rating,
    reviewCount: user.profileId.reviewCount,
    yearsOfExperience: user.profileId.yearsOfExperience,
  }));
  }



  async getPublicDoctors(filters = {}, options = {}) {
    const { search, specialty, consultationType, minRating } = filters;
    const { page = 1, limit = 10, sortBy = "rating", sortOrder = "desc" } = options;

    const query = { verificationStatus: "approved" };

    if (specialty) {
      query.specialty = { $regex: new RegExp(specialty, "i") };
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { specialty: searchRegex },
        { expertiseTags: { $in: [searchRegex] } }
      ];
    }

    if (consultationType) {
      if (consultationType === "video") {
        query["consultationSettings.video.enabled"] = true;
      } else if (consultationType === "physical") {
        query["consultationSettings.physical.enabled"] = true;
      }
    }

    if (minRating) {
      query.rating = { $gte: parseFloat(minRating) };
    }

    let sort = {};
    if (sortBy === "rating") {
      sort.rating = sortOrder === "asc" ? 1 : -1;
    } else if (sortBy === "experience") {
      sort.yearsOfExperience = sortOrder === "asc" ? 1 : -1;
    } else if (sortBy === "fee") {
      sort["consultationSettings.video.fee"] = sortOrder === "asc" ? 1 : -1;
    } else {
      sort.createdAt = sortOrder === "asc" ? 1 : -1;
    }

    const skip = (page - 1) * limit;

    const DoctorModel = this._getModel("doctor");
    const [total, doctorProfiles] = await Promise.all([
      DoctorModel.countDocuments(query),
      DoctorModel.find(query).sort(sort).skip(skip).limit(limit)
    ]);

    const profileIds = doctorProfiles.map(p => p._id);
    const sharedUsers = await SharedUser.find({ profileId: { $in: profileIds }, role: "doctor" });

    const emailMap = {};
    sharedUsers.forEach(u => {
      emailMap[u.profileId.toString()] = u.email;
    });

    const doctors = doctorProfiles.map(p => ({
      id: p._id,
      firstName: p.firstName,
      lastName: p.lastName,
      name: `${p.firstName} ${p.lastName}`,
      email: emailMap[p._id.toString()] || "",
      phone: p.phone,
      specialty: p.specialty,
      yearsOfExperience: p.yearsOfExperience,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      expertiseTags: p.expertiseTags,
      languages: p.languages,
      qualifications: p.qualifications,
      consultationSettings: p.consultationSettings,
      workingHours: p.workingHours,
      rating: p.rating,
      reviewCount: p.reviewCount,
    }));

    return {
      doctors,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getPublicDoctorById(id) {
    const DoctorModel = this._getModel("doctor");
    const doctorProfile = await DoctorModel.findOne({ _id: id, verificationStatus: "approved" });
    if (!doctorProfile) return null;

    const sharedUser = await SharedUser.findOne({ profileId: id, role: "doctor" });

    return {
      id: doctorProfile._id,
      firstName: doctorProfile.firstName,
      lastName: doctorProfile.lastName,
      name: `${doctorProfile.firstName} ${doctorProfile.lastName}`,
      email: sharedUser ? sharedUser.email : "",
      phone: doctorProfile.phone,
      specialty: doctorProfile.specialty,
      yearsOfExperience: doctorProfile.yearsOfExperience,
      bio: doctorProfile.bio,
      avatarUrl: doctorProfile.avatarUrl,
      expertiseTags: doctorProfile.expertiseTags,
      languages: doctorProfile.languages,
      qualifications: doctorProfile.qualifications,
      consultationSettings: doctorProfile.consultationSettings,
      workingHours: doctorProfile.workingHours,
      rating: doctorProfile.rating,
      reviewCount: doctorProfile.reviewCount,
    };
  }


  async delete(id) {
    const user = await SharedUser.findById(id);
    if (user) {
      const ProfileModel = this._getModel(user.role);
      await ProfileModel.findByIdAndDelete(user.profileId);
      await SharedUser.findByIdAndDelete(id);
    }
  }
}
