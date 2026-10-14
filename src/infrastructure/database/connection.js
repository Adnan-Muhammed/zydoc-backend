// //src/infrastructure/database/connection.js

// import mongoose from 'mongoose';
// const mongoUri = process.env.MONGO_URI;
// const connectDB = async () => {
//     try {
//         const conn = await mongoose.connect(mongoUri);
//         console.log(`MongoDB Connected: ${conn.connection.host}`);
//     } catch (error) {
//         console.error(`Error: ${error.message}`);
//         process.exit(1);
//     }
// };

// export default connectDB;



//src/infrastructure/database/connection.js
import fs from 'fs';
import mongoose from 'mongoose';

const isDocker = fs.existsSync('/.dockerenv');

let mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/zydoc-app";

// If running in Docker, automatically map localhost/127.0.0.1 to host.docker.internal
if (isDocker) {
    mongoUri = mongoUri.replace('127.0.0.1', 'host.docker.internal')
                       .replace('localhost', 'host.docker.internal');
}

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(mongoUri);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

export default connectDB;
