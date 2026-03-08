# Database Migrations

Drop-in migrations for the BundleNudge status page. All three produce an equivalent schema.

## Supported Databases

| Database   | Directory    | Best For                                        |
| ---------- | ------------ | ----------------------------------------------- |
| D1 (SQLite)| `d1/`        | Default. Zero-config on Cloudflare Workers.     |
| PostgreSQL | `postgres/`  | Self-hosted deployments needing ACID + JSONB.   |
| MongoDB    | `mongodb/`   | Document-oriented workloads, flexible schemas.  |

## Schema Overview

Four tables/collections:

- **status_incidents** — service disruptions and maintenance windows
- **status_incident_updates** — timeline entries per incident (FK to incidents)
- **status_subscribers** — email notification recipients with verification
- **status_config** — key-value settings store

## Running Migrations

### D1 (Cloudflare)

```bash
wrangler d1 execute bundlenudge-status-db --file=migrations/d1/001_initial.sql
```

### PostgreSQL

```bash
createdb statuspage
psql -d statuspage -f migrations/postgres/001_initial.sql
```

### MongoDB

```bash
mongosh statuspage migrations/mongodb/001_initial.js
```

## Connection Setup

### D1

No connection string needed — D1 is bound via `wrangler.toml`:

```toml
[[d1_databases]]
binding = "STATUS_DB"
database_name = "bundlenudge-status-db"
database_id = "<your-database-id>"
```

### PostgreSQL

Set a `DATABASE_URL` environment variable:

```bash
DATABASE_URL=postgres://user:password@host:5432/statuspage
```

### MongoDB

Set a `MONGODB_URI` environment variable:

```bash
MONGODB_URI=mongodb://user:password@host:27017/statuspage
```

## Switching Databases

The worker currently uses D1 via the `STATUS_DB` binding in `wrangler.toml`. The application code calls D1's `prepare/bind/run/first/all` API directly.

To switch to PostgreSQL or MongoDB:

1. Run the migration for your target database
2. Create a database adapter that implements the same query interface (`prepare/bind/run/first/all`)
3. Swap the `STATUS_DB` binding in your environment for the new adapter

> **TODO / Roadmap:** The worker code currently uses D1 queries directly (e.g., `env.STATUS_DB.prepare(...).bind(...).all()`). A proper database abstraction layer would allow swapping between D1, PostgreSQL, and MongoDB without changing route handlers. This is tracked as a future enhancement.

The D1 migration (`d1/001_initial.sql`) is the source of truth — the other migrations are kept equivalent.

## Shared Schema

`worker/src/schema.ts` is the single source of truth for table names, column mappings, and enum values in TypeScript. Import from there instead of hardcoding table names in queries.

## Trade-offs

| Feature           | D1 (SQLite)       | PostgreSQL          | MongoDB              |
| ----------------- | ----------------- | ------------------- | -------------------- |
| Hosting           | Cloudflare edge   | Self-managed/hosted | Self-managed/Atlas   |
| Schema enforcement| CHECK constraints  | ENUM types + FKs    | JSON Schema validators|
| JSON queries      | json_extract()    | JSONB operators     | Native documents     |
| Auto-increment    | AUTOINCREMENT     | SERIAL              | ObjectId             |
| Timestamps        | TEXT (ISO 8601)   | TIMESTAMPTZ         | BSON Date            |
| Triggers          | Not supported     | Yes (updated_at)    | Change streams       |
| Foreign keys      | Yes               | Yes (CASCADE)       | App-level only       |

## File Organization

```
migrations/
  README.md                              # This file
  0001_init.sql                          # Original D1 migration (applied to prod)
  0002_incident_updates_and_maintenance.sql  # D1 incremental migration
  d1/
    001_initial.sql                      # Full D1 schema (clean install)
  postgres/
    001_initial.sql                      # PostgreSQL equivalent
    README.md                            # PostgreSQL-specific notes
  mongodb/
    001_initial.js                       # MongoDB shell script
    README.md                            # MongoDB-specific notes
```

The root-level `0001_init.sql` and `0002_*.sql` are incremental D1 migrations for existing deployments. The `d1/001_initial.sql` combines them into a single file for fresh installs.
