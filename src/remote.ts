import type { Config, Memory, SearchResult } from "./types.js";
import type { Operations } from "./operations.js";

export class RemoteOperations implements Operations {
  private baseUrl: string;
  private token?: string;

  constructor(config: Config) {
    if (!config.server?.url) throw new Error("No server URL configured");
    this.baseUrl = config.server.url.replace(/\/+$/, "");
    this.token = config.server.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json()) as { data?: T; error?: string };
    if (!res.ok) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json.data as T;
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.request<SearchResult[]>("GET", `/memories/search?${params}`);
  }

  async read(query: string): Promise<Memory | undefined> {
    try {
      return await this.request<Memory>("GET", `/memories/${encodeURIComponent(query)}`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("404")) return undefined;
      throw e;
    }
  }

  async add(opts: { title: string; content: string; tags?: string[]; type?: string }): Promise<Memory> {
    return this.request<Memory>("POST", "/memories", opts);
  }

  async update(query: string, updates: { title?: string; content?: string; tags?: string[]; type?: string }): Promise<Memory> {
    return this.request<Memory>("PUT", `/memories/${encodeURIComponent(query)}`, updates);
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    return this.request<{ title: string; id: string }>("DELETE", `/memories/${encodeURIComponent(query)}`);
  }

  async list(): Promise<Memory[]> {
    return this.request<Memory[]>("GET", "/memories");
  }

  close(): void {
    // no-op for remote
  }
}
