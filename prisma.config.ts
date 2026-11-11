import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  migrations: { path: 'apps/api/prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://harbor:harbor@127.0.0.1:5432/harbor',
  },
});
