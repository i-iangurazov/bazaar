export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR";

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: AppErrorCode = "BAD_REQUEST",
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
