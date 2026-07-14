export class IntegrationNotFoundError extends Error {
  constructor(message = "Integration not found") {
    super(message);
    this.name = "IntegrationNotFoundError";
  }
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export class UpstreamRateLimitError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(message = "Upstream rate limit", retryAfterSeconds?: number) {
    super(message);
    this.name = "UpstreamRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export class WorkspaceAccessError extends Error {
  constructor(message = "Workspace not found or access denied") {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}
