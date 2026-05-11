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
├── domain                            layer
│   ├── entities
│   │   └── User.js
│   └── repositories
│       └── UserRepository.js
│   
│   
│   
├── frameworks_networks               layer
│   ├── database
│   │   ├── connection.js
│   │   ├── models
│   │   │   └── UserModel.js
│   │   └── seeders
│   │       └── AdminSeeder.js
│   └── web
│       ├── middleware
│       │   ├── adminMiddleware.js
│       │   ├── authMiddleware.js
│       │   └── roleMiddleware.js
│       └── routes
│           ├── adminAuthRoutes.js
│           ├── adminRoutes.js
│           ├── authRoutes.js
│           └── userRoutes.js
│   
│   
│   
│   
│   
│   
│   
│   
│   
│   
│   
├── interface_adapters                layer
│   ├── controllers
│   │   ├── AdminUserController.js
│   │   ├── AuthController.js
│   │   └── UserController.js
│   ├── security
│   │   ├── BcryptService.js
│   │   └── JwtService.js
│   └── storage
│       └── MongoUserRepository.js
│  
│  
│     
└── usecases                          layer
    ├── admin
    │   ├── CreateUser.js
    │   ├── DeleteUser.js
    │   ├── GetUser.js
    │   ├── ListUsers.js
    │   ├── RestoreUser.js
    │   └── UpdateUser.js
    ├── auth
    │   ├── AdminLoginUser.js
    │   ├── LoginUser.js
    │   ├── LogoutUser.js
    │   ├── RefreshToken.js
    │   └── SignupUser.js
    └── user
        ├── GetUserProfile.js
        └── UpdateUserProfile.js
        

`


    //////////////  updated 
    `
📁 src
├── application
│   └── usecases
│       ├── admin
│       │   ├── CreateUser.js
│       │   ├── DeleteUser.js
│       │   ├── GetUser.js
│       │   ├── ListUsers.js
│       │   ├── RestoreUser.js
│       │   └── UpdateUser.js
│       ├── auth
│       │   ├── AdminLoginUser.js
│       │   ├── LoginUser.js
│       │   ├── LogoutUser.js
│       │   ├── RefreshToken.js
│       │   └── SignupUser.js
│       └── user
│           ├── GetUserProfile.js
│           └── UpdateUserProfile.js
├── domain
│   ├── entities
│   │   └── User.js      
│   └── repositories     
│       └── UserRepository.js
├── infrastructure       
│   ├── config
│   │   └── .env
│   ├── database
│   │   ├── connection.js
│   │   ├── models       
│   │   │   └── UserModel.js
│   │   └── seeders      
│   │       └── AdminSeeder.js
│   ├── repositories     
│   │   └── MongoUserRepository.js
│   └── security
│       ├── BcryptService.js
│       └── JwtService.js
└── presentation
    ├── controllers      
    │   ├── AdminUserController.js
    │   ├── AuthController.js
    │   └── UserController.js
    ├── middleware       
    │   ├── adminMiddleware.js
    │   ├── authMiddleware.js
    │   └── roleMiddleware.js
    └── routes
        ├── adminAuthRoutes.js
        ├── adminRoutes.js
        ├── authRoutes.js
        └── userRoutes.js


`



