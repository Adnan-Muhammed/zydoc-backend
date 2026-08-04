import fs from "fs";
import path from "path";

const rootDir = path.join(process.cwd(), "src");

function printTree(dir, prefix = "") {
    const files = fs.readdirSync(dir);

    files.forEach((file, index) => {
        const fullPath = path.join(dir, file);
        const isLast = index === files.length - 1;
        const connector = isLast ? "└── " : "├── ";

        console.log(prefix + connector + file);

        if (fs.statSync(fullPath).isDirectory()) {
            const newPrefix = prefix + (isLast ? "    " : "│   ");
            printTree(fullPath, newPrefix);
        }
    });
}

console.log("📁 src");
printTree(rootDir);


`
📁 src
├── application
│   └── usecases
│       ├── admin
│       │   ├── CreateUser.js
│       │   ├── DeleteUser.js
│       │   ├── GetDoctorStatsUseCase.js
│       │   ├── GetDoctorsUseCase.js
│       │   ├── GetUser.js
│       │   ├── ListUsers.js
│       │   ├── RestoreUser.js
│       │   └── UpdateUser.js
│       ├── auth
│       │   ├── AdminLoginUser.js
│       │   ├── GoogleLoginUser.js
│       │   ├── LoginUser.js
│       │   ├── LogoutUser.js
│       │   ├── RefreshToken.js
│       │   ├── ResendOtp.js
│       │   ├── SetRole.js
│       │   ├── SignupUser.js
│       │   └── VerifyOtp.js
│       ├── doctor
│       │   ├── GetDoctorProfile.js
│       │   ├── GetPublicDoctorById.js
│       │   ├── GetPublicDoctors.js
│       │   ├── PatchDoctorProfile.js
│       │   └── UpdateDoctorProfile.js
│       ├── patient
│       │   ├── AddMedicalRecord.js
│       │   ├── DeleteMedicalRecord.js
│       │   ├── GetMedicalRecords.js
│       │   ├── GetPatientProfile.js
│       │   └── UpdatePatientProfile.js
│       └── user
│           ├── GetUserProfile.js
│           └── UpdateUserProfile.js
├── domain
│   ├── entities
│   │   └── User.js
│   └── repositories
│       └── UserRepository.js
├── infrastructure
│   ├── database
│   │   ├── connection.js
│   │   ├── models
│   │   │   ├── AdminProfile.js
│   │   │   ├── Appointment.js
│   │   │   ├── DoctorProfile.js
│   │   │   ├── MedicalRecord.js
│   │   │   ├── PatientProfile.js
│   │   │   └── SharedUser.js
│   │   └── seeders
│   │       └── AdminSeeder.js
│   ├── repositories
│   │   └── MongoUserRepository.js
│   └── security
│       ├── BcryptService.js
│       ├── firebaseAdmin.js
│       ├── JwtService.js
│       ├── MailService.js
│       └── OtpService.js
└── presentation
    ├── controllers
    │   ├── AdminDoctorController.js
    │   ├── AdminUserController.js
    │   ├── AppointmentController.js
    │   ├── AuthController.js
    │   ├── DoctorController.js
    │   ├── DoctorsPublicController.js
    │   ├── MedicalRecordController.js
    │   ├── PatientController.js
    │   └── UserController.js
    ├── middleware
    │   ├── adminMiddleware.js
    │   ├── authMiddleware.js
    │   ├── roleMiddleware.js
    │   └── uploadMiddleware.js
    └── routes
        ├── adminAuthRoutes.js
        ├── adminDoctorRoutes.js
        ├── adminRoutes.js
        ├── appointmentRoutes.js
        ├── authRoutes.js
        ├── doctorRoutes.js
        ├── doctorsPublicRoutes.js
        ├── patientRoutes.js
        └── userRoutes.js

`













