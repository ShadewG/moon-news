import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { requireEnv } from "@/server/config/env";

import * as schema from "./schema";

declare global {
  var __moonNewsPool__: Pool | undefined;
}

function getPool(): Pool {
  if (!globalThis.__moonNewsPool__) {
    globalThis.__moonNewsPool__ = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
    });
  }

  return globalThis.__moonNewsPool__;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}
