export * from "./types.js";
export * from "./provider.js";
export { SmtpProvider } from "./smtp.js";
export type { SmtpProviderOptions } from "./smtp.js";

// Connected-account sending (send from a client's own Gmail / Outlook mailbox).
export { GoogleProvider } from "./google.js";
export type { GoogleProviderOptions } from "./google.js";
export { MicrosoftProvider } from "./microsoft.js";
export type { MicrosoftProviderOptions } from "./microsoft.js";
export { buildMime, toBase64Url } from "./mime.js";
export * from "./oauth.js";

// VERP return-path + delivery-feedback (DSN/ARF) parsing for the bounce loop.
export { bounceReturnPath, parseBounceRecipient } from "./verp.js";
export { parseDeliveryReport } from "./feedback.js";
export type { ParsedFeedback } from "./feedback.js";

// Inbound mail parsing for native mailboxes.
export { parseInboundMessage } from "./inbound.js";
export type { InboundMessage } from "./inbound.js";
