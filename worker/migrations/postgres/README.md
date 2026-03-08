# PostgreSQL Migration

## Prerequisites

- PostgreSQL 14+
- A database created for the status page

## Setup

```bash
# Create the database
createdb statuspage

# Run the migration
psql -d statuspage -f 001_initial.sql
```

## Notes

- Uses native `ENUM` types for severity and status fields
- Uses `JSONB` for `affected_services` (queryable array) and `config.value`
- Includes a GIN index on `affected_services` for efficient `@>` containment queries
- Auto-updates `updated_at` via trigger on `status_incidents` and `status_config`
- Timestamps use `TIMESTAMPTZ` (timezone-aware)
