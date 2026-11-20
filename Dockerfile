# WP-6.5 — Docker & Infrastructure Configuration
# Multi-stage Dockerfile for optimal production image size
# Supporting k8s manifests, docker-compose for local development

FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
# Real script names: `typecheck` (not type-check) then `build`.
# Tests are NOT run here — CI runs them on every push, and a `|| true` test
# stage would only produce a green image that proves nothing.
RUN npm run typecheck && npm run build

# Production image
FROM node:20-alpine
WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Copy production dependencies (owned by the runtime user, not root)
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nextjs:nodejs /app/next.config.* ./
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "start"]
