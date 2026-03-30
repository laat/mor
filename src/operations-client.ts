import type {
  Config,
  Memory,
  MemoryFilter,
  Operations,
  SearchResult,
} from './operations.js';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function filterParams(filter?: MemoryFilter): Record<string, string> {
  if (!filter) return {};
  const p: Record<string, string> = {};
  if (filter.type) p.type = filter.type;
  if (filter.tag) p.tag = filter.tag;
  if (filter.repo) p.repo = filter.repo;
  if (filter.ext) p.ext = filter.ext;
  return p;
}

export class RemoteOperations implements Operations {
  private baseUrl: string;
  private token?: string;

  constructor(config: Config) {
    if (!config.server?.url) throw new Error('No server URL configured');
    this.baseUrl = config.server.url.replace(/\/+$/, '');
    this.token = config.server.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json()) as { data?: T; error?: string };
    if (!res.ok) {
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    }
    return json.data as T;
  }

  async search(
    query: string,
    limit = 20,
    filter?: MemoryFilter,
  ): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      ...filterParams(filter),
    });
    return this.request<SearchResult[]>('GET', `/memories/search?${params}`);
  }

  async read(query: string): Promise<Memory | undefined> {
    try {
      return await this.request<Memory>(
        'GET',
        `/memories/${encodeURIComponent(query)}`,
      );
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return undefined;
      throw e;
    }
  }

  async add(opts: {
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    type?: string;
    repository?: string;
  }): Promise<Memory> {
    return this.request<Memory>('POST', '/memories', opts);
  }

  async update(
    query: string,
    updates: {
      title?: string;
      description?: string;
      content?: string;
      tags?: string[];
      type?: string;
    },
  ): Promise<Memory> {
    return this.request<Memory>(
      'PUT',
      `/memories/${encodeURIComponent(query)}`,
      updates,
    );
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    return this.request<{ title: string; id: string }>(
      'DELETE',
      `/memories/${encodeURIComponent(query)}`,
    );
  }

  async grep(
    pattern: string,
    limit = 20,
    ignoreCase = false,
    filter?: MemoryFilter,
  ): Promise<Memory[]> {
    const params = new URLSearchParams({
      q: pattern,
      limit: String(limit),
      ...(ignoreCase ? { ignoreCase: '1' } : {}),
      ...filterParams(filter),
    });
    return this.request<Memory[]>('GET', `/memories/grep?${params}`);
  }

  async list(filter?: MemoryFilter): Promise<Memory[]> {
    const params = new URLSearchParams(filterParams(filter));
    const qs = params.toString();
    return this.request<Memory[]>('GET', `/memories${qs ? `?${qs}` : ''}`);
  }

  async reindex(): Promise<{ count: number }> {
    return this.request<{ count: number }>('POST', '/reindex');
  }

  async sync(): Promise<{ message: string }> {
    return this.request<{ message: string }>('POST', '/sync');
  }

  close(): void {
    // no-op for remote
  }
}
