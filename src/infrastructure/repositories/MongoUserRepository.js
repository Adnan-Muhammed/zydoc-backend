
// src/infrastructure/repositories/MongoUserRepository.js 

import { UserRepository } from "../../domain/repositories/UserRepository.js";
import { User } from "../../domain/entities/User.js";
import SharedUser from "../database/models/SharedUser.js";
import Doctor from "../database/models/DoctorProfile.js";
import Patient from "../database/models/PatientProfile.js";
import Admin from "../database/models/AdminProfile.js";
import Appointment from "../database/models/Appointment.js";

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

      if (roleLower === "unassigned") {
        const sharedUser = await SharedUser.create({
          email: userEntity.email,
          password: userEntity.password,
          role: userEntity.role,
          otp: userEntity.otp,
          isVerified: userEntity.isVerified,
          isProfileCompleted: false,
          googleName: userEntity.name,
          googleAvatarUrl: userEntity.avatarUrl,
        });
        return this._toEntity(sharedUser, null);
      }

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
          lastName: nameParts.slice(1).join(" ") || "",
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

  async assignRoleAndCreateProfile(userId, newRole) {
    const roleLower = newRole.toLowerCase();
    const ProfileModel = this._getModel(roleLower);

    const sharedUser = await SharedUser.findById(userId);
    if (!sharedUser) throw new Error("User not found");

    let derivedRawName = sharedUser.googleName || (sharedUser.email ? sharedUser.email.split("@")[0] : "");
    let avatarUrl = sharedUser.googleAvatarUrl || "";

    let profileData = {};
    if (roleLower === "doctor" || roleLower === "patient") {
      const nameParts = derivedRawName.split(/\s+/);
      profileData = {
        firstName: nameParts[0] || "Pending",
        lastName: nameParts.slice(1).join(" ") || "",
        avatarUrl: avatarUrl,
      };
    }

    const profile = await ProfileModel.create(profileData);

    sharedUser.role = newRole;
    sharedUser.profileId = profile._id;
    sharedUser.roleModel = newRole.charAt(0).toUpperCase() + newRole.slice(1);

    await sharedUser.save();

    return this._toEntity(sharedUser, profile);
  }

  async findByEmail(email) {
    const user = await SharedUser.findOne({ email })
      .select("+password +refreshToken +otp.code +otp.expiresAt");

    if (!user) return null;

    if (user.profileId && user.roleModel) {
      await user.populate("profileId");
    }

    return this._toEntity(user);
  }

  async findById(id) {
    const user = await SharedUser.findById(id).select("+password +refreshToken");
    if (!user) return null;

    if (user.profileId && user.roleModel) {
      await user.populate("profileId");
    }

    return this._toEntity(user);
  }

  async getProfile(userId, role) {
    const user = await SharedUser.findById(userId);
    if (!user) return null;

    const ProfileModel = this._getModel(role || user.role);
    const profile = await ProfileModel.findById(user.profileId);
    return profile;
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
    if (userEntity.name && userEntity.role !== 'unassigned') {
      const roleLower = userEntity.role.toLowerCase();
      const ProfileModel = this._getModel(roleLower);
      const userDoc = await SharedUser.findById(userEntity.id);

      let profileUpdateData = {};
      if (roleLower === "doctor" || roleLower === "patient") {
        const nameParts = userEntity.name.trim().split(/\s+/);
        profileUpdateData = {
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(" ") || "",
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
    const otpCode = typeof code === 'object' && code !== null ? code.code : code;
    const otpExpiresAt = typeof code === 'object' && code !== null ? code.expiresAt : expiresAt;

    return await SharedUser.findByIdAndUpdate(
      userId,
      {
        "otp.code": otpCode,
        "otp.expiresAt": otpExpiresAt,
      },
      { returnDocument: 'after' },
    );
  }

  async updatePasswordAndClearOtp(userId, hashedPassword) {
    return await SharedUser.findByIdAndUpdate(
      userId,
      {
        password: hashedPassword,
        $unset: { otp: "" }
      },
      { returnDocument: 'after' }
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
          returnDocument: 'after',           // Return updated document (Mongoose option)
          runValidators: true
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

  async updateBankDetails(doctorId, bankDetails) {
    try {
      const user = await SharedUser.findById(doctorId);
      let profileId = doctorId;

      if (user) {
        if (user.role !== "doctor") throw new Error("User is not a doctor");
        profileId = user.profileId;
      }

      const updatedProfile = await Doctor.findByIdAndUpdate(
        profileId,
        {
          $set: {
            bankDetails: {
              accountNumber: bankDetails.accountNumber || "",
              ifscCode: bankDetails.ifscCode || "",
              bankName: bankDetails.bankName || "",
              accountHolderName: bankDetails.accountHolderName || "",
            }
          }
        },
        { returnDocument: 'after', runValidators: true }
      );

      if (!updatedProfile) {
        throw new Error("Doctor profile not found");
      }

      return updatedProfile.bankDetails;
    } catch (error) {
      throw error;
    }
  }

  async updatePatientProfile(userId, updateData) {
    try {
      const user = await SharedUser.findById(userId);
      if (!user) throw new Error("User not found");
      if (user.role !== "patient") throw new Error("User is not a patient");

      const updatedProfile = await Patient.findByIdAndUpdate(
        user.profileId,
        updateData,
        {
          returnDocument: 'after',           // Return updated document (Mongoose option)
          runValidators: true
        }
      );

      user.isProfileCompleted = true; // Always set to true when patient completes this onboarding form
      await user.save();

      return this._toEntity(user, updatedProfile);
    } catch (error) {
      if (error.code === 11000 && error.keyValue) {
        const duplicateField = Object.keys(error.keyValue)[0];
        if (duplicateField === 'phone') {
          throw new Error("The phone number you provided is already linked to another profile.");
        }
      }
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
    } else {
      computedNameString = sharedDoc.googleName || (sharedDoc.email?.split("@")[0] || "");
    }

    const entity = new User(
      sharedDoc._id,
      computedNameString,
      sharedDoc.email,
      sharedDoc.password,
      sharedDoc.role,
      sharedDoc.accountStatus === 'suspended', // Map suspended status to isDeleted
      sharedDoc.refreshToken,
      sharedDoc.lastLogin,
    );

    // Bind transient session verification tracking flags down onto entity domain contexts
    entity.otp = sharedDoc.otp;
    entity.isVerified = sharedDoc.isVerified;
    entity.isProfileCompleted = sharedDoc.isProfileCompleted; // Exposes active status parameters up to domain use cases
    entity.verificationStatus = profile?.verificationStatus || "pending"; // Admin approval flag for doctors
    entity.approvalStatus = profile?.verificationStatus || "pending";
    entity.rejectionReason = profile?.rejectionReason || "";

    if (roleLower === 'doctor' && profile) {
      entity.medicalCertificateStatus = profile.medicalCertificateStatus;
      entity.medicalCertificateRejectionReason = profile.medicalCertificateRejectionReason;
      entity.governmentIdStatus = profile.governmentIdStatus;
      entity.governmentIdRejectionReason = profile.governmentIdRejectionReason;
      entity.qualifications = profile.qualifications || [];
      entity.consultationSettings = profile.consultationSettings;
      entity.workingHours = profile.workingHours;
      entity.slotDuration = profile.slotDuration || 15;
      entity.specialty = profile.specialty;
      entity.systemOfMedicine = profile.systemOfMedicine || "Modern Medicine";
      entity.yearsOfExperience = profile.yearsOfExperience;
      entity.bio = profile.bio;
      entity.phone = profile.phone;
      entity.firstName = profile.firstName;
      entity.lastName = profile.lastName;
      entity.expertiseTags = profile.expertiseTags || [];
      entity.languages = profile.languages || [];
    }

    if (roleLower === 'admin' && profile) {
      entity.isSuperAdmin = profile.isSuperAdmin ?? false;
      entity.permissions = Array.isArray(profile.permissions) && profile.permissions.length > 0
        ? profile.permissions
        : ['full_access'];
      entity.adminRole = profile.adminRole || 'super_admin';
      entity.department = profile.department || 'Management';
    }

    entity.profileId = profile?._id;
    if (profile && profile.avatarUrl) {
      entity.avatarUrl = profile.avatarUrl;
    } else if (sharedDoc.googleAvatarUrl) {
      entity.avatarUrl = sharedDoc.googleAvatarUrl;
    }
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

  async getAdminDoctors(filters = {}, options = {}) {
    const { search, status, specialty } = filters;
    const { sortBy = "newest" } = options;

    const pipeline = [
      { $match: { role: "doctor" } },
      {
        $lookup: {
          from: "doctors",
          localField: "profileId",
          foreignField: "_id",
          as: "profile"
        }
      },
      {
        $unwind: {
          path: "$profile",
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    const postMatch = {};

    if (search) {
      const searchRegex = new RegExp(search, "i");
      postMatch.$or = [
        { "email": searchRegex },
        { "profile.firstName": searchRegex },
        { "profile.lastName": searchRegex },
        { "profile.specialty": searchRegex }
      ];
    }

    if (specialty) {
      postMatch["profile.specialty"] = specialty;
    }

    if (status) {
      if (status === "active") {
        postMatch["accountStatus"] = "active";
        postMatch["profile.verificationStatus"] = "approved";
      } else if (status === "suspended") {
        postMatch["accountStatus"] = "suspended";
      } else if (status === "pending") {
        postMatch["profile.verificationStatus"] = "pending";
      } else if (status === "rejected") {
        postMatch["profile.verificationStatus"] = "rejected";
      }
    }

    if (Object.keys(postMatch).length > 0) {
      pipeline.push({ $match: postMatch });
    }

    pipeline.push({
      $project: {
        _id: 1,
        email: 1,
        accountStatus: 1,
        isProfileCompleted: 1,
        createdAt: 1,
        name: {
          $trim: {
            input: {
              $concat: [
                { $ifNull: ["$profile.firstName", ""] },
                " ",
                { $ifNull: ["$profile.lastName", ""] }
              ]
            }
          }
        },
        specialty: { $ifNull: ["$profile.specialty", "General Practice"] },
        rating: { $ifNull: ["$profile.rating", 0] },
        patients: { $ifNull: ["$profile.reviewCount", 0] },
        verificationStatus: { $ifNull: ["$profile.verificationStatus", "pending"] },
      }
    });

    let sortObj = { createdAt: -1 };
    if (sortBy === "name") sortObj = { name: 1 };
    else if (sortBy === "rating") sortObj = { rating: -1 };
    else if (sortBy === "patients") sortObj = { patients: -1 };
    else if (sortBy === "newest") sortObj = { createdAt: -1 };

    pipeline.push({ $sort: sortObj });

    const page = parseInt(options.page, 10) || 1;
    const limit = parseInt(options.limit, 10) || 10;
    const skip = (page - 1) * limit;

    pipeline.push({
      $facet: {
        metadata: [{ $count: "total" }],
        data: [{ $skip: skip }, { $limit: limit }]
      }
    });

    const result = await SharedUser.aggregate(pipeline);

    const data = result[0].data.map(u => ({
      ...u,
      name: u.name || "Unknown"
    }));
    const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;

    return { doctors: data, total };
  }

  async getAdminDoctorStats() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const stats = await SharedUser.aggregate([
      { $match: { role: "doctor" } },
      {
        $lookup: {
          from: "doctors",
          localField: "profileId",
          foreignField: "_id",
          as: "profile"
        }
      },
      {
        $unwind: {
          path: "$profile",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $facet: {
          total: [{ $count: "count" }],
          active: [
            {
              $match: {
                accountStatus: "active",
                "profile.verificationStatus": "approved"
              }
            },
            { $count: "count" }
          ],
          suspended: [
            { $match: { accountStatus: "suspended" } },
            { $count: "count" }
          ],
          newThisMonth: [
            { $match: { createdAt: { $gte: startOfMonth } } },
            { $count: "count" }
          ]
        }
      }
    ]);

    const result = stats[0] || {};
    return {
      total: result.total?.[0]?.count || 0,
      active: result.active?.[0]?.count || 0,
      suspended: result.suspended?.[0]?.count || 0,
      newThisMonth: result.newThisMonth?.[0]?.count || 0
    };
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
    const { search, specialty, consultationType, minRating, systemOfMedicine } = filters;
    const { page = 1, limit = 10, sortBy = "rating", sortOrder = "desc" } = options;

    // Strictly fetch only doctors whose account is active and verified
    const activeDoctorUsers = await SharedUser.find(
      { role: "doctor", accountStatus: "active" },
      { profileId: 1 }
    ).lean();
    const activeProfileIds = activeDoctorUsers.map((u) => u.profileId);

    const query = {
      _id: { $in: activeProfileIds },
      verificationStatus: "approved",
    };

    if (systemOfMedicine && systemOfMedicine !== "all") {
      query.systemOfMedicine = systemOfMedicine;
    }

    if (specialty) {
      query.specialty = { $regex: new RegExp(specialty, "i") };
    }

    const conditions = [];

    if (search) {
      const searchRegex = new RegExp(search, "i");
      conditions.push({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { specialty: searchRegex },
          { expertiseTags: { $in: [searchRegex] } }
        ]
      });
    }

    if (consultationType && consultationType !== "all") {
      if (consultationType === "video" || consultationType === "online") {
        conditions.push({
          $or: [
            { "consultationSettings.online.enabled": true },
            { "consultationSettings.video.enabled": true }
          ]
        });
      } else if (consultationType === "physical" || consultationType === "offline") {
        conditions.push({
          $or: [
            { "consultationSettings.offline.enabled": true },
            { "consultationSettings.physical.enabled": true }
          ]
        });
      }
    }

    if (conditions.length > 0) {
      query.$and = conditions;
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
      sort["consultationSettings.online.fee"] = sortOrder === "asc" ? 1 : -1;
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
      _id: p._id,
      firstName: p.firstName,
      lastName: p.lastName,
      name: `${p.firstName} ${p.lastName}`,
      email: emailMap[p._id.toString()] || "",
      phone: p.phone,
      specialty: p.specialty,
      systemOfMedicine: p.systemOfMedicine || "Modern Medicine",
      yearsOfExperience: p.yearsOfExperience,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      expertiseTags: p.expertiseTags,
      languages: p.languages,
      qualifications: p.qualifications,
      consultationSettings: p.consultationSettings,
      workingHours: p.workingHours,
      slotDuration: p.slotDuration || 15,
      timezone: p.timezone || 'Asia/Kolkata',
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
    let doctorProfile = await DoctorModel.findOne({ _id: id, verificationStatus: "approved" });
    if (!doctorProfile) {
      const sharedUser = await SharedUser.findOne({ _id: id, role: "doctor" });
      if (sharedUser && sharedUser.profileId) {
        doctorProfile = await DoctorModel.findOne({ _id: sharedUser.profileId, verificationStatus: "approved" });
      }
    }
    if (!doctorProfile) return null;

    const sharedUser = await SharedUser.findOne({ profileId: doctorProfile._id, role: "doctor" });
    if (!sharedUser || sharedUser.accountStatus !== "active") return null;

    return {
      id: doctorProfile._id,
      _id: doctorProfile._id,
      firstName: doctorProfile.firstName,
      lastName: doctorProfile.lastName,
      name: `${doctorProfile.firstName} ${doctorProfile.lastName}`,
      email: sharedUser ? sharedUser.email : "",
      phone: doctorProfile.phone,
      specialty: doctorProfile.specialty,
      systemOfMedicine: doctorProfile.systemOfMedicine || "Modern Medicine",
      yearsOfExperience: doctorProfile.yearsOfExperience,
      bio: doctorProfile.bio,
      avatarUrl: doctorProfile.avatarUrl,
      expertiseTags: doctorProfile.expertiseTags,
      languages: doctorProfile.languages,
      qualifications: doctorProfile.qualifications,
      consultationSettings: doctorProfile.consultationSettings,
      workingHours: doctorProfile.workingHours,
      slotDuration: doctorProfile.slotDuration || 15,
      timezone: doctorProfile.timezone || 'Asia/Kolkata',
      rating: doctorProfile.rating,
      reviewCount: doctorProfile.reviewCount,
    };
  }

  async getAdminDoctorById(id) {
    const sharedUser = await SharedUser.findById(id).populate("profileId");
    if (!sharedUser || sharedUser.role !== "doctor") return null;

    const p = sharedUser.profileId || {};
    return {
      id: sharedUser._id, // This matches what frontend expects for params.id
      _id: p._id || sharedUser._id,
      profileId: p._id || sharedUser.profileId,
      firstName: p.firstName,
      lastName: p.lastName,
      name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || sharedUser.name,
      email: sharedUser.email,
      phone: p.phone,
      specialty: p.specialty,
      systemOfMedicine: p.systemOfMedicine || "Modern Medicine",
      yearsOfExperience: p.yearsOfExperience,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      expertiseTags: p.expertiseTags,
      languages: p.languages,
      qualifications: p.qualifications,
      consultationSettings: p.consultationSettings,
      workingHours: p.workingHours,
      slotDuration: p.slotDuration || 15,
      timezone: p.timezone || "Asia/Kolkata",
      rejectionReason: p.rejectionReason || "",
      suspensionReason: p.suspensionReason || "",
      verifiedAt: p.verifiedAt,
      verifiedBy: p.verifiedBy,
      rating: p.rating,
      reviewCount: p.reviewCount,
      medicalCertificateUrl: p.medicalCertificateUrl,
      medicalCertificateStatus: p.medicalCertificateStatus,
      medicalCertificateRejectionReason: p.medicalCertificateRejectionReason,
      governmentIdUrl: p.governmentIdUrl,
      governmentIdStatus: p.governmentIdStatus,
      governmentIdRejectionReason: p.governmentIdRejectionReason,
      licenseNumber: p.licenseNumber,
      verificationStatus: p.verificationStatus,
      accountStatus: sharedUser.accountStatus || 'active',
      isProfileCompleted: sharedUser.isProfileCompleted,
      createdAt: sharedUser.createdAt,
      gender: p.gender,
      dob: p.dob,
      location: p.location,
      degree: p.qualifications?.length > 0 ? p.qualifications[0].degree : null,
      medicalCollege: p.qualifications?.length > 0 ? p.qualifications[0].institution : null,
      registrationNumber: p.licenseNumber,
      experience: p.yearsOfExperience,
      hospital: p.consultationSettings?.offline?.clinicName || p.clinicName,
      patients: p.reviewCount || 0,
      bankDetails: p.bankDetails || {
        accountNumber: "",
        ifscCode: "",
        bankName: "",
        accountHolderName: "",
      },
    };
  }

  async delete(id) {
    const user = await SharedUser.findById(id);
    if (user) {
      if (user.role !== 'unassigned') {
        const ProfileModel = this._getModel(user.role);
        if (ProfileModel && user.profileId) {
          await ProfileModel.findByIdAndDelete(user.profileId);
        }
      }
      return await SharedUser.findByIdAndDelete(id);
    }
    return null;
  }

  // ── Admin Doctor Management ─────────────────────────────────────────────────

  /**
   * Fetches all doctors with verificationStatus = "pending".
   * Used for the Admin Approval Queue.
   *
   * @param {object} options - { page, limit }
   * @returns {{ doctors: Array, total: number, page: number, totalPages: number }}
   */
  async getPendingDoctors(options = {}) {
    const page = Math.max(parseInt(options.page) || 1, 1);
    const limit = Math.min(parseInt(options.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Find all SharedUsers who are doctors
    const pendingDoctorProfiles = await Doctor.find(
      { verificationStatus: "pending" },
      { _id: 1 }
    ).lean();

    const pendingProfileIds = pendingDoctorProfiles.map((d) => d._id);

    // Find the corresponding SharedUsers
    const [doctors, total] = await Promise.all([
      SharedUser.find({
        role: "doctor",
        profileId: { $in: pendingProfileIds },
      })
        .populate({
          path: "profileId",
          model: "Doctor",
          select:
            "firstName lastName specialty phone avatarUrl verificationStatus " +
            "licenseNumber medicalCertificateUrl medicalCertificateStatus medicalCertificateRejectionReason " +
            "governmentIdUrl governmentIdStatus governmentIdRejectionReason qualifications consultationSettings " +
            "bio yearsOfExperience expertiseTags languages workingHours slotDuration timezone bankDetails " +
            "rejectionReason verifiedAt createdAt",
        })
        .sort({ createdAt: 1 }) // Oldest applications first (FIFO review)
        .skip(skip)
        .limit(limit)
        .lean(),

      SharedUser.countDocuments({
        role: "doctor",
        profileId: { $in: pendingProfileIds },
      }),
    ]);

    const formatted = doctors.map((u) => ({
      userId: u._id,
      email: u.email,
      accountStatus: u.accountStatus,
      createdAt: u.createdAt,
      profile: u.profileId || {},
    }));

    return {
      doctors: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Master doctor list with search, filter by verificationStatus / accountStatus /
   * specialty, and pagination. Used by GET /api/admin/doctors.
   *
   * @param {object} filters  - { search, verificationStatus, accountStatus, specialty }
   * @param {object} options  - { page, limit, sortBy }
   */
  async getAdminDoctors(filters = {}, options = {}) {
    const page = Math.max(parseInt(options.page) || 1, 1);
    const limit = Math.min(parseInt(options.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // ── Build DoctorProfile filter ────────────────────────────────────────────
    const profileFilter = {};

    if (
      filters.verificationStatus &&
      ["pending", "approved", "rejected"].includes(filters.verificationStatus)
    ) {
      profileFilter.verificationStatus = filters.verificationStatus;
    } else {
      // By default, exclude pending applications from the Admin Doctor List
      profileFilter.verificationStatus = { $ne: "pending" };
    }

    if (filters.specialty) {
      profileFilter.specialty = { $regex: filters.specialty, $options: "i" };
    }

    if (filters.search) {
      const rx = { $regex: filters.search, $options: "i" };
      profileFilter.$or = [
        { firstName: rx },
        { lastName: rx },
        { specialty: rx },
        { licenseNumber: rx },
      ];
    }

    // Get matching profile IDs first
    const matchedProfiles = await Doctor.find(profileFilter, { _id: 1 }).lean();
    const matchedIds = matchedProfiles.map((d) => d._id);

    // ── Build SharedUser filter ───────────────────────────────────────────────
    const userFilter = { role: "doctor", profileId: { $in: matchedIds } };

    if (
      filters.accountStatus &&
      ["active", "suspended"].includes(filters.accountStatus)
    ) {
      userFilter.accountStatus = filters.accountStatus;
    }

    // ── Sort ─────────────────────────────────────────────────────────────────
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name: { "profileId.firstName": 1 },
    };
    const sort = sortMap[options.sortBy] || sortMap.newest;

    // ── Query ─────────────────────────────────────────────────────────────────
    const [doctors, total] = await Promise.all([
      SharedUser.find(userFilter)
        .populate({
          path: "profileId",
          model: "Doctor",
          select:
            "firstName lastName specialty phone avatarUrl verificationStatus " +
            "licenseNumber rating reviewCount consultationSettings slotDuration " +
            "timezone yearsOfExperience bio workingHours " +
            "rejectionReason verifiedAt verifiedBy createdAt",
        })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),

      SharedUser.countDocuments(userFilter),
    ]);

    const formatted = doctors.map((u) => ({
      userId: u._id,
      email: u.email,
      accountStatus: u.accountStatus,
      isProfileCompleted: u.isProfileCompleted,
      createdAt: u.createdAt,
      profile: u.profileId || {},
    }));

    return {
      doctors: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Approves a doctor. Sets verification fields, approves all sub-documents,
   * activates the SharedUser account, and logs the action on AdminProfile.
   *
   * @param {string} doctorUserId  - SharedUser._id of the doctor
   * @param {string} adminUserId   - SharedUser._id of the acting admin
   * @returns {{ doctor: object, profile: object }}
   */
  async approveDoctor({ doctorUserId, adminUserId, documentStatuses }) {
    // 1. Fetch the doctor's SharedUser record
    const sharedUser = await SharedUser.findById(doctorUserId);
    if (!sharedUser || sharedUser.role !== "doctor") {
      throw new Error("Doctor not found");
    }

    // 2. Fetch their DoctorProfile
    const doctorProfile = await Doctor.findById(sharedUser.profileId);
    if (!doctorProfile) {
      throw new Error("Doctor profile not found");
    }

    // 3. Guard: don't re-approve if already approved
    if (doctorProfile.verificationStatus === "approved") {
      throw new Error("Doctor is already approved");
    }

    // 4. Validate document statuses: every single document must be explicitly approved
    const medCertStatus = documentStatuses?.medicalCertificateStatus || doctorProfile.medicalCertificateStatus;
    const govIdStatus = documentStatuses?.governmentIdStatus || doctorProfile.governmentIdStatus;

    if (medCertStatus !== "approved") {
      throw new Error("Cannot approve doctor. Medical Council Registration Certificate has not been approved.");
    }

    if (govIdStatus !== "approved") {
      throw new Error("Cannot approve doctor. Government Photo ID has not been approved.");
    }

    if (doctorProfile.qualifications?.length > 0) {
      const qualStatusMap = {};
      if (Array.isArray(documentStatuses?.qualifications)) {
        documentStatuses.qualifications.forEach((q) => {
          if (q && q.id) qualStatusMap[q.id] = q.certificateStatus;
        });
      }

      for (const q of doctorProfile.qualifications) {
        const qStatus = qualStatusMap[q.id] || q.certificateStatus;
        if (qStatus !== "approved") {
          throw new Error(
            `Cannot approve doctor. Academic qualification certificate (${q.degree || "Degree"}) has not been approved.`
          );
        }
      }
    }

    // 5. Update DoctorProfile — verification + all sub-document statuses
    doctorProfile.verificationStatus = "approved";
    doctorProfile.rejectionReason = "";
    doctorProfile.verifiedBy = adminUserId;
    doctorProfile.verifiedAt = new Date();
    doctorProfile.medicalCertificateStatus = "approved";
    doctorProfile.medicalCertificateRejectionReason = "";
    doctorProfile.governmentIdStatus = "approved";
    doctorProfile.governmentIdRejectionReason = "";

    if (doctorProfile.qualifications?.length > 0) {
      doctorProfile.qualifications.forEach((q) => {
        q.certificateStatus = "approved";
        q.rejectionReason = "";
      });
    }

    await doctorProfile.save();

    // 6. Activate the SharedUser account
    sharedUser.accountStatus = "active";
    await sharedUser.save();

    // 6. Log the action on AdminProfile (non-blocking — failure won't abort approval)
    try {
      if (adminUserId) {
        const adminUser = await SharedUser.findById(adminUserId);
        if (adminUser?.profileId) {
          await Admin.findByIdAndUpdate(adminUser.profileId, {
            $push: {
              adminActivityLog: {
                $each: [
                  {
                    action: "DOCTOR_APPROVED",
                    targetId: doctorProfile._id,
                    targetModel: "Doctor",
                    note: `Doctor ${doctorProfile.firstName} ${doctorProfile.lastName} approved`,
                    performedAt: new Date(),
                  },
                ],
                $slice: -200, // Keep only the 200 most recent log entries
              },
            },
          });
        }
      }
    } catch (logError) {
      console.error("[approveDoctor] Audit log write failed:", logError.message);
    }

    return {
      doctor: {
        userId: sharedUser._id,
        email: sharedUser.email,
        accountStatus: sharedUser.accountStatus,
      },
      profile: {
        firstName: doctorProfile.firstName,
        lastName: doctorProfile.lastName,
        specialty: doctorProfile.specialty,
        verificationStatus: doctorProfile.verificationStatus,
        verifiedAt: doctorProfile.verifiedAt,
      },
    };
  }

  /**
   * Rejects a doctor's application with a reason.
   * Sets verificationStatus → "rejected", stores rejectionReason,
   * and suspends the SharedUser account.
   *
   * @param {string} doctorUserId     - SharedUser._id of the doctor
   * @param {string} adminUserId      - SharedUser._id of the acting admin
   * @param {string} rejectionReason  - Human-readable reason (pre-validated in UseCase)
   */
  async rejectDoctor({ doctorUserId, adminUserId, rejectionReason, documentStatuses }) {
    // 1. Fetch the doctor's SharedUser record
    const sharedUser = await SharedUser.findById(doctorUserId);
    if (!sharedUser || sharedUser.role !== "doctor") {
      throw new Error("Doctor not found");
    }

    // 2. Fetch their DoctorProfile
    const doctorProfile = await Doctor.findById(sharedUser.profileId);
    if (!doctorProfile) {
      throw new Error("Doctor profile not found");
    }

    // 3. Update DoctorProfile — rejection fields
    doctorProfile.verificationStatus = "rejected";
    doctorProfile.rejectionReason = rejectionReason;
    doctorProfile.verifiedBy = adminUserId;
    doctorProfile.verifiedAt = new Date();

    if (documentStatuses) {
      if (documentStatuses.medicalCertificateStatus) {
        doctorProfile.medicalCertificateStatus = documentStatuses.medicalCertificateStatus;
      }
      if (documentStatuses.governmentIdStatus) {
        doctorProfile.governmentIdStatus = documentStatuses.governmentIdStatus;
      }
      if (Array.isArray(documentStatuses.qualifications) && doctorProfile.qualifications?.length > 0) {
        const qualStatusMap = {};
        documentStatuses.qualifications.forEach((q) => {
          if (q && q.id) qualStatusMap[q.id] = q.certificateStatus;
        });
        doctorProfile.qualifications.forEach((q) => {
          if (qualStatusMap[q.id]) {
            q.certificateStatus = qualStatusMap[q.id];
          }
        });
      }
    }

    await doctorProfile.save();

    // 4. Keep SharedUser account active so they can log in to their restricted dashboard and view rejectionReason
    sharedUser.accountStatus = "active";
    await sharedUser.save();

    // 5. Log the action on AdminProfile (non-blocking)
    try {
      if (adminUserId) {
        const adminUser = await SharedUser.findById(adminUserId);
        if (adminUser?.profileId) {
          await Admin.findByIdAndUpdate(adminUser.profileId, {
            $push: {
              adminActivityLog: {
                $each: [
                  {
                    action: "DOCTOR_REJECTED",
                    targetId: doctorProfile._id,
                    targetModel: "Doctor",
                    note: `Rejected: ${rejectionReason}`,
                    performedAt: new Date(),
                  },
                ],
                $slice: -200,
              },
            },
          });
        }
      }
    } catch (logError) {
      console.error("[rejectDoctor] Audit log write failed:", logError.message);
    }

    return {
      doctor: {
        userId: sharedUser._id,
        email: sharedUser.email,
        accountStatus: sharedUser.accountStatus,
      },
      profile: {
        firstName: doctorProfile.firstName,
        lastName: doctorProfile.lastName,
        verificationStatus: doctorProfile.verificationStatus,
        rejectionReason: doctorProfile.rejectionReason,
        verifiedAt: doctorProfile.verifiedAt,
      },
    };
  }

  /**
   * Updates verification status for a specific doctor document (medicalCertificate or governmentId).
   * Guard: Cannot alter document status if doctor is already approved.
   */
  async updateDoctorDocumentStatus({ doctorUserId, docType, status, reason = "", adminUserId }) {
    const sharedUser = await SharedUser.findById(doctorUserId);
    if (!sharedUser || sharedUser.role !== "doctor") {
      throw new Error("Doctor not found");
    }

    const doctorProfile = await Doctor.findById(sharedUser.profileId);
    if (!doctorProfile) {
      throw new Error("Doctor profile not found");
    }

    if (doctorProfile.verificationStatus === "approved") {
      throw new Error("Cannot modify document status for an already approved doctor.");
    }

    if (docType === "medicalCertificate") {
      doctorProfile.medicalCertificateStatus = status;
      doctorProfile.medicalCertificateRejectionReason = status === "rejected" ? (reason || "") : "";
    } else if (docType === "governmentId") {
      doctorProfile.governmentIdStatus = status;
      doctorProfile.governmentIdRejectionReason = status === "rejected" ? (reason || "") : "";
    } else {
      throw new Error(`Invalid document type: ${docType}. Must be 'medicalCertificate' or 'governmentId'`);
    }

    await doctorProfile.save();

    return {
      success: true,
      docType,
      status,
      reason: status === "rejected" ? (reason || "") : "",
      doctorProfile,
    };
  }

  /**
   * Updates verification status for a specific qualification degree certificate.
   * Guard: Cannot alter status if doctor is already approved.
   */
  async updateDoctorQualificationStatus({ doctorUserId, qualId, status, reason = "", adminUserId }) {
    const sharedUser = await SharedUser.findById(doctorUserId);
    if (!sharedUser || sharedUser.role !== "doctor") {
      throw new Error("Doctor not found");
    }

    const doctorProfile = await Doctor.findById(sharedUser.profileId);
    if (!doctorProfile) {
      throw new Error("Doctor profile not found");
    }

    if (doctorProfile.verificationStatus === "approved") {
      throw new Error("Cannot modify qualification status for an already approved doctor.");
    }

    if (!Array.isArray(doctorProfile.qualifications) || doctorProfile.qualifications.length === 0) {
      throw new Error("Doctor has no qualifications on file.");
    }

    const qual = doctorProfile.qualifications.find((q, idx) => q.id === qualId || String(idx) === qualId);
    if (!qual) {
      throw new Error(`Qualification with ID ${qualId} not found.`);
    }

    qual.certificateStatus = status;
    qual.rejectionReason = status === "rejected" ? (reason || "") : "";

    await doctorProfile.save();

    return {
      success: true,
      qualId,
      status,
      reason: status === "rejected" ? (reason || "") : "",
      qualification: qual,
    };
  }

  /**
   * Suspends an approved doctor's account with a mandatory reason.
   * - Sets accountStatus = 'suspended' and stores suspensionReason.
   * - Detects and protects any currently active online/offline consultation.
   * - Auto-cancels future appointments (status = 'cancelled_by_admin').
   * - Credits 100% wallet refund to affected patients for paid platform bookings.
   * - Updates transaction records to 'refunded'.
   * - Releases active slot locks.
   * - Creates an administrative audit log.
   */
  async suspendDoctor({ doctorUserId, reason, adminUserId }) {
    let sharedUser = await SharedUser.findById(doctorUserId);
    if (!sharedUser) {
      sharedUser = await SharedUser.findOne({ profileId: doctorUserId, role: "doctor" });
    }
    if (!sharedUser || sharedUser.role !== "doctor") {
      throw new Error("Doctor not found");
    }

    const doctorProfile = await Doctor.findById(sharedUser.profileId);
    if (!doctorProfile) {
      throw new Error("Doctor profile not found");
    }

    // 1. Mark doctor account as suspended and record reason
    sharedUser.accountStatus = "suspended";
    await sharedUser.save();

    doctorProfile.suspensionReason = reason || "";
    await doctorProfile.save();

    const doctorProfileId = doctorProfile._id;
    let activeOngoingAppointmentId = null;

    // 2. Identify currently active / ongoing consultations
    // Graceful Exit: Active consultations must NOT be terminated abruptly.
    try {
      const potentiallyActive = await Appointment.find({
        doctorId: doctorProfileId,
        status: { $in: ["scheduled", "in_progress"] },
      });

      for (const app of potentiallyActive) {
        const isOnlineActive =
          app.status === "in_progress" ||
          (app.sessionStartedAt && !app.sessionEndedAt) ||
          (app.participantsConnectedAt && !app.sessionEndedAt);

        const isOfflineActive =
          ["offline", "physical"].includes(app.consultationType) &&
          (app.status === "in_progress" ||
            (app.offlineOTPVerifiedAt && !app.sessionEndedAt));

        if (isOnlineActive || isOfflineActive) {
          activeOngoingAppointmentId = app._id.toString();
          console.log(`[suspendDoctor] Preserving active consultation: ${activeOngoingAppointmentId}`);
          break; // Preserve the current active session
        }
      }
    } catch (activeErr) {
      console.error("[suspendDoctor] Error detecting active consultations:", activeErr.message);
    }

    // 3. Auto-Cancel Future Appointments & Issue 100% Wallet Refunds
    let cancelledAppointmentsCount = 0;
    let refundedPatientsCount = 0;
    let totalRefundedAmount = 0;

    try {
      const futureAppointmentsQuery = {
        doctorId: doctorProfileId,
        status: { $in: ["scheduled", "locked"] },
      };
      if (activeOngoingAppointmentId) {
        futureAppointmentsQuery._id = { $ne: activeOngoingAppointmentId };
      }

      const futureAppointments = await Appointment.find(futureAppointmentsQuery);

      const { MongoWalletRepository } = await import("./MongoWalletRepository.js");
      const walletRepo = new MongoWalletRepository();
      const Transaction = (await import("../database/models/Transaction.js")).default;
      const Notification = (await import("../database/models/Notification.js")).default;

      for (const app of futureAppointments) {
        if (app.status === "locked") {
          // Release locked slot
          app.status = "expired";
          app.lockedBy = undefined;
          app.lockExpiryTime = undefined;
          await app.save();
          continue;
        }

        if (app.isManualBooking || app.bookedByDoctor) {
          // Manual doctor offline booking: no platform payment or wallet refund
          app.status = "cancelled_by_admin";
          app.cancellationReason = `Doctor account suspended: ${reason}`;
          app.cancelledAt = new Date();
          app.lockedBy = undefined;
          app.lockExpiryTime = undefined;
          app.roomId = undefined;
          app.offlineOTP = undefined;
          app.lateJoinCutoffAt = undefined;
          await app.save();
          cancelledAppointmentsCount++;
          continue;
        }

        // Platform Paid Appointment: issue 100% wallet refund
        const refundAmount = Number(app.feeBreakdown?.totalFee || app.fee || 0);

        if (refundAmount > 0 && app.patientId) {
          try {
            await walletRepo.creditWallet(
              app.patientId,
              refundAmount,
              "DOCTOR_SUSPENDED",
              `100% refund for appointment cancellation due to doctor account suspension (Dr. ${doctorProfile.firstName} ${doctorProfile.lastName})`,
              app._id
            );
            totalRefundedAmount += refundAmount;
            refundedPatientsCount++;
          } catch (walletErr) {
            console.error(`[suspendDoctor] Failed to refund wallet for appointment ${app._id}:`, walletErr.message);
          }

          // Mark platform transaction as refunded
          try {
            await Transaction.findOneAndUpdate(
              { appointmentId: app._id },
              { $set: { status: "refunded" } }
            );
          } catch (txErr) {
            console.error(`[suspendDoctor] Failed to update transaction for ${app._id}:`, txErr.message);
          }
        }

        // Update appointment status to cancelled_by_admin
        app.status = "cancelled_by_admin";
        app.paymentStatus = "refunded";
        app.cancellationReason = `Doctor account suspended: ${reason}`;
        app.cancelledAt = new Date();
        app.refundedAt = new Date();
        app.refundAmount = refundAmount;
        app.lockedBy = undefined;
        app.lockExpiryTime = undefined;
        app.roomId = undefined;
        app.offlineOTP = undefined;
        app.lateJoinCutoffAt = undefined;
        await app.save();
        cancelledAppointmentsCount++;

        // Send patient notification
        try {
          if (app.patientId) {
            const dateStr = app.appointmentDate
              ? new Date(app.appointmentDate).toDateString()
              : "";
            await Notification.create({
              recipientId: app.patientId,
              recipientModel: "User",
              type: "APPOINTMENT_CANCELLED",
              title: "Appointment Cancelled & 100% Refunded",
              message: `Your appointment with Dr. ${doctorProfile.firstName} ${doctorProfile.lastName} on ${dateStr} at ${app.appointmentTime} has been cancelled due to doctor account suspension. A full refund of ₹${refundAmount} has been credited to your wallet.`,
              referenceId: app._id,
            });
          }
        } catch (notifErr) {
          console.error(`[suspendDoctor] Notification failed for patient ${app.patientId}:`, notifErr.message);
        }
      }
    } catch (cancelErr) {
      console.error("[suspendDoctor] Error processing upcoming appointment cancellations:", cancelErr.message);
    }

    // 4. Log the action on AdminProfile
    try {
      if (adminUserId) {
        const adminUser = await SharedUser.findById(adminUserId);
        if (adminUser?.profileId) {
          await Admin.findByIdAndUpdate(adminUser.profileId, {
            $push: {
              adminActivityLog: {
                $each: [
                  {
                    action: "DOCTOR_SUSPENDED",
                    targetId: doctorProfile._id,
                    targetModel: "Doctor",
                    note: `Doctor ${doctorProfile.firstName} ${doctorProfile.lastName} suspended: ${reason}. Cancelled: ${cancelledAppointmentsCount}, Refunded: ₹${totalRefundedAmount}`,
                    performedAt: new Date(),
                  },
                ],
                $slice: -200,
              },
            },
          });
        }
      }
    } catch (logError) {
      console.error("[suspendDoctor] Audit log write failed:", logError.message);
    }

    return {
      success: true,
      message: `Dr. ${doctorProfile.firstName} ${doctorProfile.lastName} account has been suspended.`,
      doctor: {
        userId: sharedUser._id,
        email: sharedUser.email,
        accountStatus: sharedUser.accountStatus,
      },
      profile: {
        firstName: doctorProfile.firstName,
        lastName: doctorProfile.lastName,
        verificationStatus: doctorProfile.verificationStatus,
        suspensionReason: doctorProfile.suspensionReason,
      },
      activeSessionPreserved: !!activeOngoingAppointmentId,
      activeAppointmentId: activeOngoingAppointmentId,
      cancelledAppointmentsCount,
      refundedPatientsCount,
      totalRefundedAmount,
    };
  }

  /**
   * Returns aggregate doctor counts for admin KPI cards.
   * Runs all counts in parallel for performance.
   *
   * @returns {{
   *   total: number,
   *   pending: number,
   *   approved: number,
   *   rejected: number,
   *   suspended: number,
   * }}
   */
  async getAdminDoctorStats() {
    const [
      total,
      pending,
      approved,
      rejected,
      suspended,
    ] = await Promise.all([
      // Total doctor SharedUser count
      SharedUser.countDocuments({ role: "doctor" }),

      // By verificationStatus (from DoctorProfile)
      Doctor.countDocuments({ verificationStatus: "pending" }),
      Doctor.countDocuments({ verificationStatus: "approved" }),
      Doctor.countDocuments({ verificationStatus: "rejected" }),

      // Suspended accounts (from SharedUser)
      SharedUser.countDocuments({ role: "doctor", accountStatus: "suspended" }),
    ]);

    return { total, pending, approved, rejected, suspended };
  }

  /**
   * Master patient list with search (name, email, phone), status filtering,
   * pagination, and per-patient stats (total appointments booked, current wallet balance).
   *
   * @param {object} filters  - { search, status, accountStatus, gender }
   * @param {object} options  - { page, limit, sortBy }
   * @returns {Promise<{ patients: object[], total: number, page: number, limit: number, totalPages: number }>}
   */
  async getAdminPatients(filters = {}, options = {}) {
    const page = Math.max(parseInt(options.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    let userFilter = { role: "patient" };

    // ── Search by name, email, or phone ──────────────────────────────────────
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      const rx = { $regex: searchTerm, $options: "i" };

      // Search matching Patient profiles (firstName, lastName, phone)
      const patientProfileQuery = {
        $or: [
          { firstName: rx },
          { lastName: rx },
          { phone: rx },
        ],
      };

      const words = searchTerm.split(/\s+/);
      if (words.length > 1) {
        patientProfileQuery.$or.push({
          $and: [
            { firstName: { $regex: words[0], $options: "i" } },
            { lastName: { $regex: words.slice(1).join(" "), $options: "i" } },
          ],
        });
      }

      const [matchedPatients, matchedUsersByEmail] = await Promise.all([
        Patient.find(patientProfileQuery, { _id: 1 }).lean(),
        SharedUser.find(
          {
            role: "patient",
            $or: [{ email: rx }, { googleName: rx }],
          },
          { profileId: 1 }
        ).lean(),
      ]);

      const matchedProfileIds = new Set(
        matchedPatients.map((p) => p._id.toString())
      );
      matchedUsersByEmail.forEach((u) => {
        if (u.profileId) matchedProfileIds.add(u.profileId.toString());
      });

      if (matchedProfileIds.size === 0) {
        return {
          patients: [],
          total: 0,
          page,
          limit,
          totalPages: 1,
        };
      }

      userFilter.profileId = { $in: Array.from(matchedProfileIds) };
    }

    // Account status filter (active, suspended)
    const statusVal = filters.status || filters.accountStatus;
    if (statusVal && ["active", "suspended"].includes(statusVal.toLowerCase())) {
      userFilter.accountStatus = statusVal.toLowerCase();
    }

    // Sorting
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
    };
    const sort = sortMap[options.sortBy] || sortMap.newest;

    // Execute queries
    const [patients, total] = await Promise.all([
      SharedUser.find(userFilter)
        .populate({
          path: "profileId",
          model: "Patient",
          select:
            "firstName lastName phone dateOfBirth gender bloodGroup avatarUrl walletBalance emergencyContact address medicalHistory createdAt",
        })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      SharedUser.countDocuments(userFilter),
    ]);

    // Aggregate appointments for the patients on the current page
    const patientUserIds = patients.map((u) => u._id);
    let countsMap = new Map();

    if (patientUserIds.length > 0) {
      try {
        const appointmentAgg = await Appointment.aggregate([
          { $match: { patientId: { $in: patientUserIds } } },
          {
            $group: {
              _id: "$patientId",
              totalAppointments: { $sum: 1 },
              completedAppointments: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
              cancelledAppointments: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        ["cancelled", "cancelled_by_doctor", "doctor_missed"],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

        countsMap = new Map(
          appointmentAgg.map((item) => [item._id.toString(), item])
        );
      } catch (aggErr) {
        console.error("[getAdminPatients] Aggregation error:", aggErr.message);
      }
    }

    const formatted = patients.map((u) => {
      const profile = u.profileId || {};
      const appStats = countsMap.get(u._id.toString()) || {
        totalAppointments: 0,
        completedAppointments: 0,
        cancelledAppointments: 0,
      };

      const fullName = profile.firstName
        ? `${profile.firstName} ${profile.lastName || ""}`.trim()
        : u.googleName || "Registered Patient";

      return {
        userId: u._id,
        email: u.email,
        accountStatus: u.accountStatus,
        isProfileCompleted: u.isProfileCompleted,
        createdAt: u.createdAt,
        profile: {
          firstName: profile.firstName || "",
          lastName: profile.lastName || "",
          fullName,
          phone: profile.phone || "",
          gender: profile.gender || "",
          bloodGroup: profile.bloodGroup || "",
          dateOfBirth: profile.dateOfBirth || null,
          avatarUrl: profile.avatarUrl || u.googleAvatarUrl || "",
          walletBalance: Number(profile.walletBalance || 0),
          emergencyContact: profile.emergencyContact || null,
          address: profile.address || null,
        },
        stats: {
          totalAppointments: appStats.totalAppointments,
          completedAppointments: appStats.completedAppointments,
          cancelledAppointments: appStats.cancelledAppointments,
          currentWalletBalance: Number(profile.walletBalance || 0),
        },
      };
    });

    return {
      patients: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Fetches single patient profile with full appointment history and detailed stats.
   *
   * @param {string} patientUserId - SharedUser._id or profileId
   */
  async getAdminPatientById(patientUserId) {
    let sharedUser = await SharedUser.findOne({
      _id: patientUserId,
      role: "patient",
    })
      .populate({
        path: "profileId",
        model: "Patient",
      })
      .lean();

    if (!sharedUser) {
      sharedUser = await SharedUser.findOne({
        profileId: patientUserId,
        role: "patient",
      })
        .populate({
          path: "profileId",
          model: "Patient",
        })
        .lean();
    }

    if (!sharedUser) {
      throw new Error("Patient not found");
    }

    const profile = sharedUser.profileId || {};

    // Fetch recent appointments for this patient
    const appointments = await Appointment.find({ patientId: sharedUser._id })
      .sort({ appointmentDate: -1, createdAt: -1 })
      .limit(10)
      .populate("doctorId", "firstName lastName specialty phone avatarUrl")
      .lean();

    // Stats
    const totalAppointments = await Appointment.countDocuments({
      patientId: sharedUser._id,
    });
    const completedAppointments = await Appointment.countDocuments({
      patientId: sharedUser._id,
      status: "completed",
    });
    const cancelledAppointments = await Appointment.countDocuments({
      patientId: sharedUser._id,
      status: { $in: ["cancelled", "cancelled_by_doctor", "doctor_missed"] },
    });

    return {
      userId: sharedUser._id,
      email: sharedUser.email,
      accountStatus: sharedUser.accountStatus,
      isProfileCompleted: sharedUser.isProfileCompleted,
      createdAt: sharedUser.createdAt,
      profile: {
        ...profile,
        fullName: profile.firstName
          ? `${profile.firstName} ${profile.lastName || ""}`.trim()
          : sharedUser.googleName || "Registered Patient",
        avatarUrl: profile.avatarUrl || sharedUser.googleAvatarUrl || "",
        walletBalance: Number(profile.walletBalance || 0),
      },
      stats: {
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        currentWalletBalance: Number(profile.walletBalance || 0),
      },
      recentAppointments: appointments,
    };
  }

  /**
   * Aggregate patient statistics for dashboard KPI cards.
   */
  async getAdminPatientStats() {
    const [total, active, suspended, patientsWithWallet] = await Promise.all([
      SharedUser.countDocuments({ role: "patient" }),
      SharedUser.countDocuments({ role: "patient", accountStatus: "active" }),
      SharedUser.countDocuments({ role: "patient", accountStatus: "suspended" }),
      Patient.aggregate([
        { $match: { walletBalance: { $gt: 0 } } },
        { $group: { _id: null, totalBalance: { $sum: "$walletBalance" }, count: { $sum: 1 } } },
      ]),
    ]);

    const walletStats = patientsWithWallet[0] || { totalBalance: 0, count: 0 };

    return {
      total,
      active,
      suspended,
      patientsWithBalance: walletStats.count,
      totalWalletLiability: walletStats.totalBalance,
    };
  }

  /**
   * Toggle a doctor or patient account status between 'active' and 'suspended'.
   * Logs the action to AdminProfile.adminActivityLog for audit tracking.
   *
   * @param {Object} params
   * @param {string} params.targetId   - SharedUser._id or Doctor/Patient profileId
   * @param {string} params.role       - Expected role: 'doctor' | 'patient'
   * @param {string} params.adminUserId - SharedUser._id of the acting admin
   * @param {string} [params.reason]   - Optional administrative reason
   */
  async toggleUserStatus({ targetId, role, adminUserId, reason = "" }) {
    // 1. Resolve SharedUser by primary ID or profileId
    let sharedUser = await SharedUser.findById(targetId);
    if (!sharedUser) {
      sharedUser = await SharedUser.findOne({ profileId: targetId });
    }

    if (!sharedUser) {
      const error = new Error(`User not found with identifier: ${targetId}`);
      error.statusCode = 404;
      throw error;
    }

    // 2. Validate role matching if provided
    if (role && sharedUser.role.toLowerCase() !== role.toLowerCase()) {
      const error = new Error(
        `User ${sharedUser.email} is a '${sharedUser.role}', not a '${role}'.`
      );
      error.statusCode = 400;
      throw error;
    }

    // 3. Toggle accountStatus
    const previousStatus = sharedUser.accountStatus || "active";
    const newStatus = previousStatus === "active" ? "suspended" : "active";

    // If suspending a doctor, delegate to suspendDoctor to trigger refund and cancellation workflows
    if (sharedUser.role.toLowerCase() === "doctor" && newStatus === "suspended") {
      return await this.suspendDoctor({
        doctorUserId: sharedUser._id,
        reason: reason || "Account suspended by administrator via status toggle",
        adminUserId,
      });
    }

    sharedUser.accountStatus = newStatus;
    await sharedUser.save();

    // 4. Log the action on AdminProfile (non-blocking audit log)
    try {
      if (adminUserId) {
        const adminUser = await SharedUser.findById(adminUserId);
        if (adminUser?.profileId) {
          const actionType = `${sharedUser.role.toUpperCase()}_STATUS_TOGGLED`;
          const targetModel =
            sharedUser.role.toLowerCase() === "doctor" ? "Doctor" : "Patient";

          await Admin.findByIdAndUpdate(adminUser.profileId, {
            $push: {
              adminActivityLog: {
                $each: [
                  {
                    action: actionType,
                    targetId: sharedUser.profileId || sharedUser._id,
                    targetModel: targetModel,
                    note: `Account status toggled from '${previousStatus}' to '${newStatus}'${
                      reason ? " - Reason: " + reason : ""
                    }`,
                    performedAt: new Date(),
                  },
                ],
                $slice: -200,
              },
            },
          });
        }
      }
    } catch (logErr) {
      console.error("[toggleUserStatus] Audit log failed:", logErr.message);
    }

    return {
      userId: sharedUser._id,
      profileId: sharedUser.profileId,
      email: sharedUser.email,
      role: sharedUser.role,
      previousStatus,
      newStatus,
      message: `${
        sharedUser.role.charAt(0).toUpperCase() + sharedUser.role.slice(1)
      } account has been ${newStatus}.`,
    };
  }
}
