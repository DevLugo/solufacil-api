# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.1 --activate

WORKDIR /app

# Copy root package files (exclude turbo.json to avoid workspace-wide builds)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files to leverage Docker cache
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
COPY packages/graphql-schema/package.json ./packages/graphql-schema/
COPY packages/business-logic/package.json ./packages/business-logic/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (only for API and its packages)
RUN pnpm install --frozen-lockfile --filter @solufacil/api...

# Copy source code (ONLY API and packages, NOT web)
COPY apps/api ./apps/api
COPY packages/database ./packages/database
COPY packages/graphql-schema ./packages/graphql-schema
COPY packages/business-logic ./packages/business-logic
COPY packages/shared ./packages/shared

# Generate Prisma client
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN pnpm --filter @solufacil/database db:generate

# Build packages in dependency order (without turbo to avoid workspace issues)
RUN pnpm --filter @solufacil/shared build && \
    pnpm --filter @solufacil/graphql-schema build && \
    pnpm --filter @solufacil/business-logic build && \
    pnpm --filter @solufacil/api build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@8.15.1 --activate

WORKDIR /app

# Copy built application
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

WORKDIR /app/apps/api

CMD ["node", "dist/server.js"]
