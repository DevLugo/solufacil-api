# SoluFácil API

GraphQL API backend for SoluFácil microloans management system.

## Tech Stack

- Node.js 20
- TypeScript
- Apollo GraphQL Server
- Prisma ORM
- PostgreSQL (Neon)
- Express.js

## Development

```bash
# Install dependencies
pnpm install

# Setup database
cp .env.example .env
# Edit .env with your DATABASE_URL

# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:push

# Start dev server
pnpm dev
```

API runs on `http://localhost:4000/graphql`

## Production Deployment

Deployed on DigitalOcean App Platform using Docker.

See `.do/app.yaml` for configuration.

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret
- `JWT_REFRESH_SECRET` - JWT refresh token secret
- `CORS_ORIGIN` - Frontend URL (Vercel)
- `CLOUDINARY_*` - Image upload credentials

See `.env.example` for full list.
