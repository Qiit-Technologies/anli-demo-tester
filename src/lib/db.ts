import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForPool = globalThis as typeof globalThis & {
  anliDemoPool?: Pool;
  anliDemoDbReady?: Promise<void>;
};

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  globalForPool.anliDemoPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    ssl:
      process.env.PGSSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
  });

  return globalForPool.anliDemoPool;
}

export async function initializeDatabase(): Promise<Pool> {
  const pool = getPool();

  globalForPool.anliDemoDbReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS demo_rooms (
        hotel_id INTEGER NOT NULL,
        room_id TEXT NOT NULL,
        room_type_id TEXT NOT NULL,
        room_type_name TEXT NOT NULL,
        room_number TEXT NOT NULL,
        capacity INTEGER,
        room_status TEXT,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (hotel_id, room_id)
      );

      CREATE TABLE IF NOT EXISTS demo_bookings (
        id UUID PRIMARY KEY,
        hotel_id INTEGER NOT NULL,
        booking_code TEXT,
        external_confirm_id TEXT,
        ota_booking_code TEXT,
        pms_guest_id TEXT,
        room_id TEXT,
        room_type_id TEXT,
        room_number TEXT,
        guest_name TEXT NOT NULL,
        guest_email TEXT,
        guest_phone TEXT,
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        total_price NUMERIC(12, 2) NOT NULL,
        currency TEXT NOT NULL,
        number_of_guests INTEGER NOT NULL,
        status TEXT NOT NULL,
        origin TEXT NOT NULL,
        source TEXT,
        pms_forwarded BOOLEAN,
        has_room_conflict BOOLEAN NOT NULL DEFAULT FALSE,
        raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (check_out > check_in)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS demo_bookings_booking_code_uq
        ON demo_bookings (hotel_id, booking_code)
        WHERE booking_code IS NOT NULL AND booking_code <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS demo_bookings_external_ref_uq
        ON demo_bookings (hotel_id, external_confirm_id)
        WHERE external_confirm_id IS NOT NULL AND external_confirm_id <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS demo_bookings_pms_guest_uq
        ON demo_bookings (hotel_id, pms_guest_id)
        WHERE pms_guest_id IS NOT NULL AND pms_guest_id <> '';
      CREATE INDEX IF NOT EXISTS demo_bookings_room_dates_idx
        ON demo_bookings (hotel_id, room_id, check_in, check_out);
      ALTER TABLE demo_bookings ALTER COLUMN guest_email DROP NOT NULL;

      CREATE TABLE IF NOT EXISTS demo_webhook_events (
        id UUID PRIMARY KEY,
        hotel_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS demo_webhook_events_received_idx
        ON demo_webhook_events (hotel_id, received_at DESC);
    `);
  })().catch((error: unknown) => {
    globalForPool.anliDemoDbReady = undefined;
    throw error;
  });

  await globalForPool.anliDemoDbReady;
  return pool;
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = await initializeDatabase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function isBlockingStatus(status: string): boolean {
  return !["CANCELLED", "CANCELED", "CREATE_FAILED", "NO_SHOW"].includes(
    status.toUpperCase(),
  );
}

export async function acquireBookingLocks(
  client: PoolClient,
  keys: Array<string | null | undefined>,
): Promise<void> {
  const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))].sort();
  for (const key of uniqueKeys) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
  }
}

export async function findRoomConflict(
  client: PoolClient,
  input: {
    hotelId: number;
    roomId: string;
    checkIn: string;
    checkOut: string;
    excludeBookingId?: string;
  },
): Promise<QueryResultRow | undefined> {
  const result = await client.query(
    `
      SELECT id, booking_code, guest_name, check_in, check_out
      FROM demo_bookings
      WHERE hotel_id = $1
        AND room_id = $2
        AND status NOT IN ('CANCELLED', 'CANCELED', 'CREATE_FAILED', 'NO_SHOW')
        AND check_in < $4::date
        AND check_out > $3::date
        AND ($5::uuid IS NULL OR id <> $5::uuid)
      LIMIT 1
    `,
    [
      input.hotelId,
      input.roomId,
      input.checkIn,
      input.checkOut,
      input.excludeBookingId ?? null,
    ],
  );
  return result.rows[0];
}
