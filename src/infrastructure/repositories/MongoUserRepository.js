
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

      if (updateData.consultationSettings) {
        const currentProfile = await Doctor.findById(user.profileId).lean();

        // Deep copy workingHours to avoid mutating the lean object directly in a weird way
        let newWorkingHours = updateData.workingHours ? JSON.parse(JSON.stringify(updateData.workingHours)) : (currentProfile.workingHours ? JSON.parse(JSON.stringify(currentProfile.workingHours)) : { online: {}, offline: {} });
        let modified = false;

        const days = ['mondayToFriday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        if (updateData.consultationSettings.video && updateData.consultationSettings.video.enabled === false) {
          newWorkingHours.online = newWorkingHours.online || {};
          days.forEach(day => {
            if (newWorkingHours.online[day]) {
              newWorkingHours.online[day].active = false;
              modified = true;
            }
          });
        }

        if (updateData.consultationSettings.physical && updateData.consultationSettings.physical.enabled === false) {
          newWorkingHours.offline = newWorkingHours.offline || {};
          days.forEach(day => {
            if (newWorkingHours.offline[day]) {
              newWorkingHours.offline[day].active = false;
              modified = true;
            }
          });
        }

        if (modified) {
          updateData.workingHours = newWorkingHours;
        }
      }

      const updatedProfile = await Doctor.findByIdAndUpdate(
        user.profileId,
        updateData,
        {
          new: true,           // Return updated document (Mongoose option)
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

  async updatePatientProfile(userId, updateData) {
    try {
      const user = await SharedUser.findById(userId);
      if (!user) throw new Error("User not found");
      if (user.role !== "patient") throw new Error("User is not a patient");

      const updatedProfile = await Patient.findByIdAndUpdate(
        user.profileId,
        updateData,
        {
          new: true,           // Return updated document (Mongoose option)
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
      sharedDoc.isDeleted,
      sharedDoc.refreshToken,
      sharedDoc.lastLogin,
    );

    // Bind transient session verification tracking flags down onto entity domain contexts
    entity.otp = sharedDoc.otp;
    entity.isVerified = sharedDoc.isVerified;
    entity.isProfileCompleted = sharedDoc.isProfileCompleted; // Exposes active status parameters up to domain use cases
    entity.verificationStatus = profile?.verificationStatus || "pending"; // Admin approval flag for doctors

    if (roleLower === 'doctor' && profile) {
      entity.medicalCertificateStatus = profile.medicalCertificateStatus;
      entity.medicalCertificateRejectionReason = profile.medicalCertificateRejectionReason;
      entity.governmentIdStatus = profile.governmentIdStatus;
      entity.governmentIdRejectionReason = profile.governmentIdRejectionReason;
      entity.qualifications = profile.qualifications || [];
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

  async getAdminDoctorById(id) {
    const sharedUser = await SharedUser.findById(id).populate("profileId");
    if (!sharedUser || sharedUser.role !== "doctor") return null;

    const p = sharedUser.profileId || {};
    return {
      id: sharedUser._id, // This matches what frontend expects for params.id
      firstName: p.firstName,
      lastName: p.lastName,
      name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || sharedUser.name,
      email: sharedUser.email,
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
      hospital: p.clinicName,
      patients: p.reviewCount || 0
    };
  }

  async getAdminPatients(filters = {}, options = {}) {
    const { search, status, gender } = filters;
    const { sortBy = "newest" } = options;

    const pipeline = [
      { $match: { role: "patient" } },
      {
        $lookup: {
          from: "patients",
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
        { "profile.phone": searchRegex }
      ];
    }

    if (gender) {
      postMatch["profile.gender"] = gender;
    }

    if (status) {
      if (status === "active") {
        postMatch["accountStatus"] = "active";
      } else if (status === "suspended") {
        postMatch["accountStatus"] = "suspended";
      } else if (status === "inactive") {
        postMatch["accountStatus"] = "inactive";
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
        phone: { $ifNull: ["$profile.phone", ""] },
        gender: { $ifNull: ["$profile.gender", ""] },
        age: {
          $cond: {
            if: { $ifNull: ["$profile.dateOfBirth", false] },
            then: {
              $floor: {
                $divide: [
                  { $subtract: [new Date(), "$profile.dateOfBirth"] },
                  31557600000 // ms in a year
                ]
              }
            },
            else: 0
          }
        },
        bloodGroup: { $ifNull: ["$profile.bloodGroup", ""] },
        avatarUrl: { $ifNull: ["$profile.avatarUrl", ""] }
      }
    });

    let sortObj = { createdAt: -1 };
    if (sortBy === "name") sortObj = { name: 1 };
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

    return { patients: data, total };
  }

  async getAdminPatientStats() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const stats = await SharedUser.aggregate([
      { $match: { role: "patient" } },
      {
        $facet: {
          total: [{ $count: "count" }],
          active: [
            { $match: { accountStatus: "active" } },
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

  async getAdminPatientById(id) {
    const sharedUser = await SharedUser.findById(id).populate("profileId");
    if (!sharedUser || sharedUser.role !== "patient") return null;

    const p = sharedUser.profileId || {};
    
    let age = 0;
    if (p.dateOfBirth) {
        const diff = new Date().getTime() - new Date(p.dateOfBirth).getTime();
        age = Math.floor(diff / 31557600000);
    }

    return {
      id: sharedUser._id,
      firstName: p.firstName,
      lastName: p.lastName,
      name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || sharedUser.name,
      email: sharedUser.email,
      phone: p.phone,
      dateOfBirth: p.dateOfBirth,
      age: age,
      gender: p.gender,
      bloodGroup: p.bloodGroup,
      avatarUrl: p.avatarUrl,
      accountStatus: sharedUser.accountStatus || 'active',
      isProfileCompleted: sharedUser.isProfileCompleted,
      createdAt: sharedUser.createdAt,
      
      emergencyContact: p.emergencyContact || {},
      address: p.address || {},
      medicalHistory: p.medicalHistory || { allergies: [], chronicConditions: [], currentMedications: [] },
      
      appts: 0, // Placeholder, can be populated properly if an Appointment repository is queried
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
