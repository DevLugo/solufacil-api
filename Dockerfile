# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /app

# Copy root package files (exclude turbo.json to avoid workspace-wide builds)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all package.json files to leverage Docker cache
COPY packages/database/package.json ./packages/database/
COPY packages/graphql-schema/package.json ./packages/graphql-schema/
COPY packages/business-logic/package.json ./packages/business-logic/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (only for API and its packages)
RUN pnpm install --frozen-lockfile --filter @solufacil/api...

# Copy source code (API and packages)
COPY src ./src
COPY tsconfig.json ./
COPY packages/database ./packages/database
COPY packages/graphql-schema ./packages/graphql-schema
COPY packages/business-logic ./packages/business-logic
COPY packages/shared ./packages/shared

# Generate Prisma client
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN pnpm --filter @solufacil/database db:generate

# Build packages and API in dependency order
RUN pnpm --filter @solufacil/shared build && \
    pnpm --filter @solufacil/database build && \
    pnpm --filter @solufacil/graphql-schema build && \
    pnpm --filter @solufacil/business-logic build && \
    tsc

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /app

# Copy built application
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/server.js"]
