# MongoDB Migration

## Prerequisites

- MongoDB 6.0+ (for JSON Schema validator support)
- `mongosh` shell installed

## Setup

```bash
# Run the migration (creates a "statuspage" database if it doesn't exist)
mongosh statuspage 001_initial.js
```

## Notes

- Uses JSON Schema validators to enforce document structure at the database level
- `incident_id` in `status_incident_updates` stores an `ObjectId` reference (not a foreign key — MongoDB has no FK constraints, enforce in application code)
- `affected_services` is a native array with a multikey index for efficient queries
- `status_config` uses a unique index on `key` to simulate a primary key
- Timestamps are stored as BSON `Date` objects (use `new Date()` when inserting)
