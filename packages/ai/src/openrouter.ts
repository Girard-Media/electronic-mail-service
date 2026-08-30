/**
 * OpenRouter adapter — the single sanctioned inference dependency
 * (planning/VISION.md §2.4, ADR-0005).
 *
 * Deliberately thin. Everything that matters — schemas, budgets, caching,
 * fallbacks, the ledger — lives in the gateway, so swapping providers is this
 * file and nothing else.
 */

import type { ProviderPort, ProviderRequest, ProviderResponse } from "./gateway.js";

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Sent as HTTP-Referer/X-Title; OpenRouter uses them for attribution. */
  appUrl?: string;
  appName?: string;
  /** Per-million-token pricing, when we want cost computed locally. */
  priceTable?: Record<string, { inputPerM: number; outputPerM: number }>;
}

interface ChatChoice { message?: { content?: string } }
interface ChatUsage { prompt_tokens?: number; completion_tokens?: number; total_cost?: number }
interface ChatResponse { id?: string; choices?: ChatChoice[]; usage?: ChatUsage; error?: { message?: string } }

export class OpenRouterProvider implements ProviderPort {
  readonly id = "openrouter";
  private baseUrl: string;

  constructor(private opts: OpenRouterOptions) {
    this.baseUrl = (opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    if (!opts.apiKey) {
      // Fail at construction, not at the first send. A gateway holding a
      // provider that can never work would degrade every call silently.
      throw new Error("OPENROUTER_API_KEY is required to construct OpenRouterProvider");
    }
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Content-Type": "application/json",
          ...(this.opts.appUrl ? { "HTTP-Referer": this.opts.appUrl } : {}),
          ...(this.opts.appName ? { "X-Title": this.opts.appName } : {}),
        },
        body: JSON.stringify({
          model: req.model,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          // Ask for JSON where the model supports it. The gateway still
          // validates — this only reduces how often the repair retry is needed.
          response_format: { type: "json_object" },
          usage: { include: true },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`openrouter ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as ChatResponse;
      if (json.error?.message) throw new Error(`openrouter: ${json.error.message}`);

      const text = json.choices?.[0]?.message?.content ?? "";
      const inputTokens = json.usage?.prompt_tokens ?? 0;
      const outputTokens = json.usage?.completion_tokens ?? 0;

      return {
        text,
        inputTokens,
        outputTokens,
        costUsd: json.usage?.total_cost ?? this.priceOf(req.model, inputTokens, outputTokens),
        responseId: json.id ?? null,
      };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // Normalised so the gateway records "timeout" rather than a generic
        // provider error — the two want different operator responses.
        throw new Error(`openrouter request timed out after ${req.timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private priceOf(model: string, input: number, output: number): number {
    const p = this.opts.priceTable?.[model];
    if (!p) return 0;
    return (input / 1_000_000) * p.inputPerM + (output / 1_000_000) * p.outputPerM;
  }
}

/**
 * Build a provider from the environment, or return null when no key is set.
 *
 * Returning null rather than throwing is deliberate: EMS must run, send, and
 * report honestly with no inference configured at all. Every AI task has a
 * documented degraded mode, and this is the seam where that starts.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderPort | null {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return new OpenRouterProvider({
    apiKey,
    baseUrl: env.OPENROUTER_BASE_URL,
    appUrl: "https://electronicmailservices.com",
    appName: "Electronic Mail Services",
  });
}
