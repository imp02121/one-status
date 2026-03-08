import {
  StatusPageError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
} from "./errors";
import type {
  StatusPageClientOptions,
  StatusResponse,
  UptimeEntry,
  UptimeResponse,
  IncidentsResponse,
  IncidentWithUpdates,
  CreateIncidentInput,
  UpdateIncidentInput,
  AddIncidentUpdateInput,
  SubscribersResponse,
  SubscriberCount,
  NotifyResult,
  StatusPageConfig,
} from "./types";

const DEFAULT_TIMEOUT = 30_000;

export class StatusPageClient {
  private readonly baseUrl: string;
  private readonly adminToken?: string;
  private readonly timeout: number;

  constructor(options: StatusPageClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.adminToken = options.adminToken;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  // ── Public Endpoints ──

  async getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("GET", "/status");
  }

  async getUptime(service: string, days?: number): Promise<UptimeEntry[]> {
    const params = new URLSearchParams({ service });
    if (days !== undefined) {
      params.set("days", String(days));
    }
    const response = await this.request<UptimeResponse>("GET", `/uptime?${params.toString()}`);
    return response.entries;
  }

  async getIncidents(options?: { page?: number; limit?: number }): Promise<IncidentsResponse> {
    const params = new URLSearchParams();
    if (options?.page !== undefined) {
      params.set("page", String(options.page));
    }
    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    const qs = params.toString();
    return this.request<IncidentsResponse>("GET", `/incidents${qs ? `?${qs}` : ""}`);
  }

  async subscribe(email: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("POST", "/subscribe", { email });
  }

  // ── Admin: Incidents ──

  async createIncident(data: CreateIncidentInput): Promise<{ id: number; message: string }> {
    this.requireAdmin();
    return this.request<{ id: number; message: string }>("POST", "/incidents", data);
  }

  async updateIncident(id: number | string, data: UpdateIncidentInput): Promise<{ message: string }> {
    this.requireAdmin();
    return this.request<{ message: string }>("PUT", `/incidents/${id}`, data);
  }

  async deleteIncident(id: number | string): Promise<{ message: string }> {
    this.requireAdmin();
    return this.request<{ message: string }>("DELETE", `/incidents/${id}`);
  }

  async getIncident(id: number | string): Promise<IncidentWithUpdates> {
    return this.request<IncidentWithUpdates>("GET", `/incidents/${id}`);
  }

  async addIncidentUpdate(
    id: number | string,
    data: AddIncidentUpdateInput,
  ): Promise<{ id: number; message: string }> {
    this.requireAdmin();
    return this.request<{ id: number; message: string }>("POST", `/incidents/${id}/updates`, data);
  }

  // ── Admin: Subscribers ──

  async listSubscribers(
    options?: { page?: number; limit?: number; verified?: boolean },
  ): Promise<SubscribersResponse> {
    this.requireAdmin();
    const params = new URLSearchParams();
    if (options?.page !== undefined) {
      params.set("page", String(options.page));
    }
    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options?.verified !== undefined) {
      params.set("verified", String(options.verified));
    }
    const qs = params.toString();
    return this.request<SubscribersResponse>("GET", `/admin/subscribers${qs ? `?${qs}` : ""}`);
  }

  async removeSubscriber(id: number | string): Promise<{ message: string }> {
    this.requireAdmin();
    return this.request<{ message: string }>("DELETE", `/admin/subscribers/${id}`);
  }

  async getSubscriberCount(): Promise<SubscriberCount> {
    this.requireAdmin();
    return this.request<SubscriberCount>("GET", "/admin/subscribers/count");
  }

  async notifySubscribers(data: { subject: string; html: string }): Promise<NotifyResult> {
    this.requireAdmin();
    return this.request<NotifyResult>("POST", "/admin/subscribers/notify", data);
  }

  // ── Admin: Config ──

  async getConfig(): Promise<{ config: StatusPageConfig | null }> {
    this.requireAdmin();
    return this.request<{ config: StatusPageConfig | null }>("GET", "/admin/config");
  }

  async updateConfig(config: StatusPageConfig): Promise<{ message: string }> {
    this.requireAdmin();
    return this.request<{ message: string }>("PUT", "/admin/config", config);
  }

  // ── Internal ──

  private requireAdmin(): void {
    if (!this.adminToken) {
      throw new AuthenticationError("Admin token is required for this operation");
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (this.adminToken) {
      headers["Authorization"] = `Bearer ${this.adminToken}`;
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new StatusPageError(`Request timed out after ${this.timeout}ms`, 0, "TIMEOUT");
      }
      throw new StatusPageError(
        error instanceof Error ? error.message : "Network error",
        0,
        "NETWORK_ERROR",
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.ok) {
      return response.json() as Promise<T>;
    }

    const errorBody = await response.json().catch(() => null) as {
      error?: string;
      details?: Record<string, string[]>;
    } | null;
    const message = errorBody?.error ?? response.statusText;

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message);
      case 404:
        throw new NotFoundError(message);
      case 400:
      case 422:
        throw new ValidationError(message, errorBody?.details);
      case 429: {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(message, retryAfter ? parseInt(retryAfter, 10) : undefined);
      }
      default:
        throw new StatusPageError(message, response.status);
    }
  }
}
