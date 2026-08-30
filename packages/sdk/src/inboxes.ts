/**
 * Programmatic inboxes — the public /inboxes API (planning/AGENT_EMAIL.md A1).
 *
 * Create/update/delete require a full-access key. Listing, reading messages,
 * sending, and replying work with either key kind.
 */

export type InboxKind = "shared" | "custom";

export interface InboxRecord {
  id: string;
  address: string;
  display_name: string | null;
  status: string;
  kind: InboxKind;
  created_at: string;
  messages?: number;
  unread?: number;
  keep_copy?: boolean;
  catch_all?: boolean;
  used_bytes?: number;
  quota_bytes?: number;
}

export interface InboxDomain {
  domain: string;
  default: boolean;
  /** Live MX check — false means the address can send but cannot receive yet. */
  receiving: boolean;
}

export interface InboxMessage {
  id: string;
  thread_id: string;
  from: string;
  to?: string[];
  subject: string | null;
  snippet: string | null;
  seen: boolean;
  folder?: string;
  received_at: string;
  message_id?: string | null;
  in_reply_to?: string | null;
  text?: string | null;
  html?: string | null;
  flagged?: boolean;
}

export interface InboxThread {
  id: string;
  message_count: number;
  unread: boolean;
  last_at: string;
  subject: string | null;
  from: string | null;
  snippet: string | null;
}

export interface CreateInboxParams {
  /** Local-part. Omit on a shared domain to get `agent-<hex>`. Required for custom domains. */
  username?: string;
  /** Shared domain by name, or a verified sending domain of this project. Omit for the default shared domain. */
  domain?: string;
  display_name?: string;
}

export interface UpdateInboxParams {
  display_name?: string;
  keep_copy?: boolean;
  /** Custom-domain inboxes only. */
  catch_all?: boolean;
}

export interface ListMessagesQuery {
  folder?: "inbox" | "sent" | "archive" | "spam" | "trash" | "all";
  q?: string;
  limit?: number;
  /** ISO-8601 cursor from the previous page's `next_before`. */
  before?: string;
}

export interface SendFromInboxParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface ReplyParams {
  text?: string;
  html?: string;
}

export type SdkRequest = <T>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
) => Promise<T>;

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Bound onto `EMS.inboxes`. */
export function createInboxesResource(request: SdkRequest) {
  return {
    /** Shared domains an inbox can be claimed on, with live receive-readiness. */
    domains: (): Promise<{ data: InboxDomain[] }> => request("/inboxes/domains"),

    create: (params: CreateInboxParams = {}): Promise<InboxRecord> =>
      request("/inboxes", { method: "POST", body: JSON.stringify(params) }),

    list: (): Promise<{ data: InboxRecord[] }> => request("/inboxes"),

    get: (id: string): Promise<InboxRecord> =>
      request(`/inboxes/${encodeURIComponent(id)}`),

    update: (id: string, params: UpdateInboxParams): Promise<{ id: string; updated: boolean }> =>
      request(`/inboxes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(params),
      }),

    remove: (id: string): Promise<{ id: string; deleted: boolean }> =>
      request(`/inboxes/${encodeURIComponent(id)}`, { method: "DELETE" }),

    send: (
      id: string,
      params: SendFromInboxParams,
    ): Promise<{ id: string; message_id: string }> =>
      request(`/inboxes/${encodeURIComponent(id)}/send`, {
        method: "POST",
        body: JSON.stringify(params),
      }),

    messages: {
      list: (
        inboxId: string,
        query: ListMessagesQuery = {},
      ): Promise<{ data: InboxMessage[]; next_before: string | null }> =>
        request(
          `/inboxes/${encodeURIComponent(inboxId)}/messages${qs({
            folder: query.folder,
            q: query.q,
            limit: query.limit,
            before: query.before,
          })}`,
        ),

      get: (inboxId: string, messageId: string): Promise<InboxMessage> =>
        request(
          `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
        ),

      update: (
        inboxId: string,
        messageId: string,
        params: { seen?: boolean; flagged?: boolean; folder?: Exclude<ListMessagesQuery["folder"], "all"> },
      ): Promise<{ id: string; updated: boolean }> =>
        request(
          `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
          { method: "PATCH", body: JSON.stringify(params) },
        ),

      reply: (
        inboxId: string,
        messageId: string,
        params: ReplyParams,
      ): Promise<{ id: string; message_id: string; thread_id: string }> =>
        request(
          `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`,
          { method: "POST", body: JSON.stringify(params) },
        ),
    },

    threads: {
      list: (
        inboxId: string,
        query: { limit?: number } = {},
      ): Promise<{ data: InboxThread[] }> =>
        request(
          `/inboxes/${encodeURIComponent(inboxId)}/threads${qs({ limit: query.limit })}`,
        ),

      get: (
        inboxId: string,
        threadId: string,
      ): Promise<{ id: string; data: InboxMessage[] }> =>
        request(
          `/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}`,
        ),
    },
  };
}
