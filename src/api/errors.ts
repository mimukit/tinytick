/** An HTTP error from a TickTick API call. */
export class TickTickApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(TickTickApiError.describe(status, path, body));
    this.name = "TickTickApiError";
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  private static describe(status: number, path: string, body: string): string {
    if (status === 401 || status === 403) return "TickTick rejected the login. Sign in again from the Account command.";
    if (status === 404) return `Not found: ${path}`;
    if (status === 429) return "TickTick rate limit. Try again in a minute.";
    const detail = body.slice(0, 200).trim();
    return `TickTick error ${status} on ${path}${detail ? `: ${detail}` : ""}`;
  }
}

/** A readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
