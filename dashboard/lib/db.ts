import { Pool } from "pg";

// Lazy singleton so `next build` (which imports pages) never opens sockets.
// Connection comes from either DATABASE_URL or the discrete PG* env vars
// (PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT), which node-postgres reads
// natively — the PG* route avoids percent-encoding passwords into a URI.
let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) return null;
  if (!pool) {
    pool = new Pool({
      ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
      connectionTimeoutMillis: 3000,
      max: 5,
    });
    // Don't let an idle-client error take the server down.
    pool.on("error", (err) => console.warn("[db] pool error:", err.message));
  }
  return pool;
}
