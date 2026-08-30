/**
 * Stable error shape: { statusCode, name, message }.
 * Thrown anywhere in the API and rendered by the API error handler.
 */
export class ApiError extends Error {
  statusCode: number;
  override name: string;

  constructor(statusCode: number, name: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = name;
  }

  toJSON() {
    return { statusCode: this.statusCode, name: this.name, message: this.message };
  }
}

export const errors = {
  validation: (message: string) => new ApiError(422, "validation_error", message),
  unauthorized: () =>
    new ApiError(401, "unauthorized", "Missing or invalid API key."),
  notFound: (message = "Resource not found.") =>
    new ApiError(404, "not_found", message),
  forbidden: (message = "You don't have permission to do that.") =>
    new ApiError(403, "forbidden", message),
  suppressed: (address: string) =>
    new ApiError(
      422,
      "suppressed_recipient",
      `Recipient ${address} is on the project suppression list.`,
    ),
  rateLimited: () =>
    new ApiError(429, "rate_limit_exceeded", "Too many requests."),
  unverifiedDomain: (domain: string) =>
    new ApiError(
      403,
      "domain_not_verified",
      `The domain "${domain}" is not a verified sending domain for this project. Add and verify it before sending.`,
    ),
  emailUnverified: () =>
    new ApiError(
      403,
      "email_unverified",
      "Verify your account email before sending from a EMS-hosted address. Add and verify your own domain to send as that domain.",
    ),
  sharedInboxSendingDisabled: () =>
    new ApiError(
      403,
      "shared_inbox_sending_disabled",
      "Shared-domain inboxes are not accepting sends on this instance.",
    ),
  totpRequired: () =>
    new ApiError(
      403,
      "totp_required",
      "Set up authenticator TOTP in God Mode before impersonating.",
    ),
  totpInvalid: () =>
    new ApiError(401, "totp_invalid", "That authenticator code is not valid."),
  domainTaken: (name: string) =>
    new ApiError(
      409,
      "domain_taken",
      `The domain "${name}" is already verified on another project.`,
    ),
  // Plan limit / feature gate (402 Payment Required) — the dashboard turns this
  // into an upgrade prompt.
  planLimit: (message: string) =>
    new ApiError(402, "plan_limit_exceeded", message),
  // The resource exists but is in a state that forbids the operation — e.g.
  // cancelling a message that already left. Distinct from a 422: the request
  // was well-formed, the world just moved on.
  conflict: (name: string, message: string) => new ApiError(409, name, message),
  // Mailbox over quota — Postfix pipe treats 507 as TEMPFAIL (exit 75) and defers.
  mailboxFull: () =>
    new ApiError(507, "mailbox_full", "This mailbox is over quota."),
};
