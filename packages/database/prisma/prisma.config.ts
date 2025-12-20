// Prisma 7 config
// DATABASE_URL is loaded from packages/database/.env
// The schema can be specified in the URL using ?schema=your_schema
export default {
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
}
