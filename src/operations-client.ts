import { getStoredToken, refreshAccessToken } from './oauth-login.js';
import type {
  Config,
  GrepOptions,
  Memory,
  MemoryFilter,
  Operations,
  Paginated,
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
  private headers: Record<string, string>;
  private configDir?: string;

  constructor(config: Config, configDir?: string) {
    if (!config.server?.url) throw new Error('No server URL configured');
    this.baseUrl = config.server.url.replace(/\/+$/, '');
    this.configDir = configDir;
    this.headers = { 'Content-Type': 'application/json' };

    // Priority: explicit token > stored OAuth token
    if (config.server.token) {
      this.headers['Authorization'] = `Bearer ${config.server.token}`;
    } else if (configDir) {
      const stored = getStoredToken(configDir, this.baseUrl);
      if (stored) this.headers['Authorization'] = `Bearer ${stored}`;
    }
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.configDir) return false;
    const newToken = await refreshAccessToken(this.configDir, this.baseUrl);
    if (!newToken) return false;
    this.headers['Authorization'] = `Bearer ${newToken}`;
    return true;
  }

  async search(
    query: string,
    limit = 20,
    filter?: MemoryFilter,
    offset = 0,
  ): Promise<Paginated<SearchResult>> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      offset: String(offset),
      ...filterParams(filter),
    });
    let res = await fetch(`${this.baseUrl}/memories/search?${params}`, {
      headers: this.headers,
    });
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(`${this.baseUrl}/memories/search?${params}`, {
        headers: this.headers,
      });
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json;
  }

  async read(query: string): Promise<Memory | undefined> {
    let res = await fetch(
      `${this.baseUrl}/memories/${encodeURIComponent(query)}`,
      { headers: this.headers },
    );
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(
        `${this.baseUrl}/memories/${encodeURIComponent(query)}`,
        { headers: this.headers },
      );
    }
    if (res.status === 404) return undefined;
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  async add(opts: {
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    type?: string;
    repository?: string;
  }): Promise<Memory> {
    let res = await fetch(`${this.baseUrl}/memories`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(opts),
    });
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(`${this.baseUrl}/memories`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(opts),
      });
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json.data;
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
    let res = await fetch(
      `${this.baseUrl}/memories/${encodeURIComponent(query)}`,
      { method: 'PUT', headers: this.headers, body: JSON.stringify(updates) },
    );
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(
        `${this.baseUrl}/memories/${encodeURIComponent(query)}`,
        {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify(updates),
        },
      );
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    let res = await fetch(
      `${this.baseUrl}/memories/${encodeURIComponent(query)}`,
      { method: 'DELETE', headers: this.headers },
    );
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(
        `${this.baseUrl}/memories/${encodeURIComponent(query)}`,
        { method: 'DELETE', headers: this.headers },
      );
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  async grep(pattern: string, opts?: GrepOptions): Promise<Paginated<Memory>> {
    const {
      limit = 20,
      ignoreCase = false,
      filter,
      offset = 0,
      regex = false,
    } = opts ?? {};
    const params = new URLSearchParams({
      q: pattern,
      limit: String(limit),
      offset: String(offset),
      ...(ignoreCase ? { ignoreCase: '1' } : {}),
      ...(regex ? { regex: '1' } : {}),
      ...filterParams(filter),
    });
    let res = await fetch(`${this.baseUrl}/memories/grep?${params}`, {
      headers: this.headers,
    });
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(`${this.baseUrl}/memories/grep?${params}`, {
        headers: this.headers,
      });
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json;
  }

  async list(
    filter?: MemoryFilter,
    limit = 100,
    offset = 0,
  ): Promise<Paginated<Memory>> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      ...filterParams(filter),
    });
    let res = await fetch(`${this.baseUrl}/memories?${params}`, {
      headers: this.headers,
    });
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(`${this.baseUrl}/memories?${params}`, {
        headers: this.headers,
      });
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json;
  }

  async reindex() {
    let res = await fetch(`${this.baseUrl}/reindex`, {
      method: 'POST',
      headers: this.headers,
    });
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(`${this.baseUrl}/reindex`, {
        method: 'POST',
        headers: this.headers,
      });
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  async sync(_commitMessage?: string): Promise<{ message: string }> {
    let res = await fetch(`${this.baseUrl}/sync`, {
      method: 'POST',
      headers: this.headers,
    });
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await fetch(`${this.baseUrl}/sync`, {
        method: 'POST',
        headers: this.headers,
      });
    }
    const json = await res.json();
    if (!res.ok)
      throw new HttpError(res.status, json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  close(): void {}
}
