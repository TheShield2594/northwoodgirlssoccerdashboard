import { Pool } from "pg";

// Lazy singleton so `next build` (which imports pages) never opens sockets.
let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      max: 5,
    });
    // Don't let an idle-client error take the server down.
    pool.on("error", (err) => console.warn("[db] pool error:", err.message));
  }
  return pool;
}
