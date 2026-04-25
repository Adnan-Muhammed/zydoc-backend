import { UserRepository } from '../../domain/repositories/UserRepository.js';
import { User } from '../../domain/entities/User.js';
import UserModel from '../../frameworks_networks/database/models/UserModel.js';

export class MongoUserRepository extends UserRepository {
    async create(userEntity) {
        const userModel = new UserModel({
            name: userEntity.name,
            email: userEntity.email,
            password: userEntity.password,
            role: userEntity.role,
            isDeleted: userEntity.isDeleted,
            createdBy: userEntity.createdBy // Added createdBy
        });

        const savedUser = await userModel.save();
        return this._toEntity(savedUser);
    }

    async findByEmail(email) {
        // Find even if soft deleted to handle "email already in use" checks properly
        const user = await UserModel.findOne({ email }).select('+password +refreshToken');
        return user ? this._toEntity(user) : null;
    }

    async findById(id) {
        const user = await UserModel.findById(id).select('+password +refreshToken');
        return user ? this._toEntity(user) : null;
    }

    async update(userEntity) {
        await UserModel.findByIdAndUpdate(userEntity.id, {
            name: userEntity.name,
            email: userEntity.email,
            password: userEntity.password,
            role: userEntity.role,
            refreshToken: userEntity.refreshToken,
            lastLogin: userEntity.lastLogin,
            isDeleted: userEntity.isDeleted
        });
    }

    // New methods for Admin CRUD
    async count(query = {}) {
        return await UserModel.countDocuments(query);
    }

    async find(query = {}, options = {}) {
        const { skip = 0, limit = 10, sort = { createdAt: -1 } } = options;
        const users = await UserModel.find(query)
            .select('-password -refreshToken')
            .sort(sort)
            .skip(skip)
            .limit(limit);

        return users.map(user => this._toEntity(user));
    }

    async delete(id) {
        await UserModel.findByIdAndDelete(id);
    }

    _toEntity(mongoUser) {
        const user = new User(
            mongoUser._id,
            mongoUser.name,
            mongoUser.email,
            mongoUser.password,
            mongoUser.role, // role might be derived from isAdmin in MVC, but here we stick to role string
            mongoUser.isDeleted,
            mongoUser.refreshToken,
            mongoUser.lastLogin
        );
        // Ensure role is consistent if legacy data uses isAdmin boolean
        if (!user.role && mongoUser.isAdmin) {
            user.role = 'admin';
        }
        return user;
    }
}
