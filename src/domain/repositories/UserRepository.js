// zydoc-backend/src/domain/repositories/UserRepository.js
// This is conceptually an interface. In JS, we can document it or use a base class.

export class UserRepository {
    async create(user) { throw new Error('Method not implemented'); }
    async findByEmail(email) { throw new Error('Method not implemented'); }
    async findById(id) { throw new Error('Method not implemented'); }
    async update(user) { throw new Error('Method not implemented'); }
    async count(query) { throw new Error('Method not implemented'); }
    async find(query, options) { throw new Error('Method not implemented'); }
    async delete(id) { throw new Error('Method not implemented'); }
    async getPublicDoctors(filters, options) { throw new Error('Method not implemented'); }
    async getPublicDoctorById(id) { throw new Error('Method not implemented'); }
    async updateBankDetails(doctorId, bankDetails) { throw new Error('Method not implemented'); }
}
