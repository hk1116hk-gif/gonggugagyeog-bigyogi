import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export function getPrisma(): PrismaClient {
  if (!globalThis.__prisma) {
    globalThis.__prisma = new PrismaClient();
  }
  return globalThis.__prisma;
}

/** DB가 없어도(키/마이그레이션 전) 앱이 터지지 않게: 호출부를 try/catch로 감싼다. */
export async function safeDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  try {
    return await fn(getPrisma());
  } catch {
    return null;
  }
}
