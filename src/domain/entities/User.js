export class User {
    constructor(id, name, email, password, role, isDeleted = false, refreshToken = null, lastLogin = null) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.password = password;
        this.role = role || 'user';
        this.isDeleted = isDeleted;
        this.refreshToken = refreshToken;
        this.lastLogin = lastLogin;
    }

    // Domain logic validation could go here
    isValid() {
        return this.name && this.email && this.password;
    }
}
