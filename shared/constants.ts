/** Services monitored by the status page */
export type ServiceName =
  | "api"
  | "dashboard"
  | "authentication"
  | "edge-delivery"
  | "ota-updates"
  | "build-service"
  | "documentation";

export const SERVICE_NAMES: readonly ServiceName[] = [
  "api",
  "dashboard",
  "authentication",
  "edge-delivery",
  "ota-updates",
  "build-service",
  "documentation",
] as const;

export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  api: "API",
  dashboard: "Dashboard",
  authentication: "Authentication",
  "edge-delivery": "Edge Delivery",
  "ota-updates": "OTA Updates",
  "build-service": "Build Service",
  documentation: "Documentation",
};
