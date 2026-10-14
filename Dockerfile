# ==========================================
# 1. Base Image: Lightweight Node.js 20 Alpine
# ==========================================
FROM node:20-alpine

# ==========================================
# 2. Set Working Directory
# ==========================================
WORKDIR /app

# ==========================================
# 3. Copy Dependency Manifests
# ==========================================
COPY package*.json ./

# ==========================================
# 4. Install Production Dependencies
# ==========================================
RUN npm ci --omit=dev

# ==========================================
# 5. Copy Application Source Code
# ==========================================
COPY . .

# ==========================================
# 6. Create Uploads Directory and Set Permissions
# ==========================================
RUN mkdir -p /app/uploads && chown -R node:node /app

# ==========================================
# 7. Environment Defaults & Security User
# ==========================================
ENV NODE_ENV=production
ENV PORT=5001

# Run as non-privileged 'node' user
USER node

# ==========================================
# 8. Expose Backend Port
# ==========================================
EXPOSE 5001

# ==========================================
# 9. Startup Command
# ==========================================
CMD ["node", "server.js"]
