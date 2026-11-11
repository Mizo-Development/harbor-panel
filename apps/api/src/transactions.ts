import { Prisma } from '@prisma/client';
import type { Db } from './db';
export async function serial<T>(
  db: Db,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let i = 0; ; i++)
    try {
      return await db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 });
    } catch (error) {
      if (
        i >= 4 ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !['P2034', 'P2002'].includes(error.code)
      )
        throw error;
      await new Promise((r) => setTimeout(r, 20 * (i + 1)));
    }
}
