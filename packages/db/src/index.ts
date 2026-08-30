// Prisma client singleton for the ems control plane.
// Run `pnpm db:generate` to produce ./generated before first use.
import { PrismaClient } from "./generated/index.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "./generated/index.js";
