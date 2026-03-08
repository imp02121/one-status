// BundleNudge Status Page — MongoDB schema setup
// Run: mongosh statuspage 001_initial.js

const severities = ["critical", "major", "minor", "maintenance"];
const statuses = ["investigating", "identified", "monitoring", "resolved"];

// --- status_incidents ---
db.createCollection("status_incidents", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["title", "severity", "status", "affected_services", "created_at", "updated_at"],
      properties: {
        title: { bsonType: "string", description: "Incident title" },
        description: { bsonType: "string", description: "Detailed description" },
        severity: { enum: severities, description: "Incident severity level" },
        status: { enum: statuses, description: "Current incident status" },
        affected_services: {
          bsonType: "array",
          items: { bsonType: "string" },
          description: "Array of affected service slugs",
        },
        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" },
        resolved_at: { bsonType: ["date", "null"] },
      },
    },
  },
});

db.status_incidents.createIndex({ status: 1 });
db.status_incidents.createIndex({ created_at: -1 });
db.status_incidents.createIndex({ severity: 1 });
db.status_incidents.createIndex({ affected_services: 1 });

// --- status_incident_updates ---
db.createCollection("status_incident_updates", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["incident_id", "message", "status", "created_at"],
      properties: {
        incident_id: { bsonType: "objectId", description: "Reference to parent incident" },
        message: { bsonType: "string", description: "Update message" },
        status: { enum: statuses, description: "Status at time of update" },
        created_at: { bsonType: "date" },
      },
    },
  },
});

db.status_incident_updates.createIndex({ incident_id: 1 });
db.status_incident_updates.createIndex({ created_at: -1 });

// --- status_subscribers ---
db.createCollection("status_subscribers", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "verified", "created_at"],
      properties: {
        email: { bsonType: "string", description: "Subscriber email address" },
        verified: { bsonType: "bool" },
        verify_token: { bsonType: ["string", "null"] },
        unsubscribe_token: { bsonType: ["string", "null"] },
        created_at: { bsonType: "date" },
      },
    },
  },
});

db.status_subscribers.createIndex({ email: 1 }, { unique: true });
db.status_subscribers.createIndex({ verify_token: 1 });
db.status_subscribers.createIndex({ unsubscribe_token: 1 });

// --- status_config ---
db.createCollection("status_config", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["key", "value", "updated_at"],
      properties: {
        key: { bsonType: "string", description: "Config key" },
        value: { description: "Config value (any BSON type)" },
        updated_at: { bsonType: "date" },
      },
    },
  },
});

db.status_config.createIndex({ key: 1 }, { unique: true });

print("BundleNudge status page collections and indexes created.");
