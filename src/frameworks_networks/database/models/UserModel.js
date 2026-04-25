import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        password: {
            type: String,
            required: true,
            select: false,
        },
        role: {
            type: String,
            enum: ["user", "admin", "doctor", "patient"],
            default: "patient",
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        refreshToken: {
            type: String,
            select: false,
            default: null
        },
        lastLogin: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true,
    }
);

const User = mongoose.model("User", userSchema);
export default User;
