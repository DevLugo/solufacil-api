FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /app

# Copy everything
COPY . .

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Set DATABASE_URL for Prisma generation
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Build everything
RUN pnpm build

# Set production environment
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/server.js"]
