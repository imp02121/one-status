export class StatusPageError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "StatusPageError";
    this.status = status;
    this.code = code;
  }
}

export class AuthenticationError extends StatusPageError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "AuthenticationError";
  }
}

export class NotFoundError extends StatusPageError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends StatusPageError {
  readonly details?: Record<string, string[]>;

  constructor(message = "Validation failed", details?: Record<string, string[]>) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.details = details;
  }
}

export class RateLimitError extends StatusPageError {
  readonly retryAfter?: number;

  constructor(message = "Rate limit exceeded", retryAfter?: number) {
    super(message, 429, "RATE_LIMITED");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}
