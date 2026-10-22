import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { loadConfig } from './config.js';
import { startServer } from './operations-server.js';

const PASSPHRASE = 'web-secret';

let testDir: string;
let server: http.Server;
let baseUrl: string;

async function start(token?: string) {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-web-test-'));
  process.env.MOR_HOME = testDir;
  server = startServer(loadConfig(), { port: 0, host: '127.0.0.1', token });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

function get(p: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${p}`, { redirect: 'manual', headers });
}

function post(
  p: string,
  form: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}${p}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(form).toString(),
  });
}

async function createNote(
  title: string,
  content: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await post(
    '/ui/new',
    { title, content, description: '', tags: 'a, b', type: 'knowledge' },
    headers,
  );
  expect(res.status).toBe(303);
  return decodeURIComponent(
    res.headers.get('location')!.replace('/ui/notes/', ''),
  );
}

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(testDir, { recursive: true });
  delete process.env.MOR_HOME;
});

describe('web UI without token', () => {
  beforeEach(() => start());

  it('redirects / to /ui', async () => {
    const res = await get('/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/ui');
  });

  it('creates, lists and shows a note', async () => {
    const id = await createNote('Hello', '# Heading\n\nSome **bold** text');

    const list = await (await get('/ui')).text();
    expect(list).toContain('Hello');

    const res = await get(`/ui/notes/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    const html = await res.text();
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="/ui?tag=a"');
  });

  it('searches notes', async () => {
    await createNote('Kubernetes tips', 'kubectl get pods');
    await createNote('Cooking', 'pasta recipe');
    const html = await (await get('/ui?q=kubectl')).text();
    expect(html).toContain('Kubernetes tips');
    expect(html).not.toContain('Cooking');
  });

  it('escapes raw HTML in notes', async () => {
    const id = await createNote(
      '<b>Title</b>',
      'before <script>alert(1)</script> after',
    );
    const html = await (await get(`/ui/notes/${id}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Title&lt;/b&gt;');
  });

  it('highlights code blocks', async () => {
    const id = await createNote(
      'Code',
      '```ts\nconst a = "<b>";\n```\n\n```nosuchlang\n<i>plain</i>\n```',
    );
    const html = await (await get(`/ui/notes/${id}`)).text();
    expect(html).toContain('<code class="hljs language-ts">');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('&quot;&lt;b&gt;&quot;');
    expect(html).toContain('&lt;i&gt;plain&lt;/i&gt;');
    expect(html).not.toContain('<i>plain</i>');
  });

  it('rewrites mor: links to UI links', async () => {
    const target = await createNote('Target', 'target body');
    const id = await createNote('Source', `See [target](mor:${target})`);
    const html = await (await get(`/ui/notes/${id}`)).text();
    expect(html).toContain(`href="/ui/notes/${target}"`);
  });

  it('opens notes from mor: links with a short id', async () => {
    const target = await createNote('Target', 'target body');
    const short = target.slice(0, 8).toUpperCase();
    const id = await createNote('Source', `See [target](mor:${short})`);
    const html = await (await get(`/ui/notes/${id}`)).text();
    expect(html).toContain(`href="/ui/notes/${short}"`);

    const res = await get(`/ui/notes/${short}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('target body');
  });

  it('edits a note', async () => {
    const id = await createNote('Original', 'old content');
    const form = await (await get(`/ui/notes/${id}/edit`)).text();
    const updated = form.match(/name="updated" value="([^"]+)"/)![1];

    const res = await post(`/ui/notes/${id}`, {
      updated,
      title: 'Renamed',
      description: 'desc',
      tags: 'x',
      type: 'snippet',
      content: 'line one\r\nline two',
    });
    expect(res.status).toBe(303);

    const note = (await (await get(`/notes/${id}`)).json()).data;
    expect(note.title).toBe('Renamed');
    expect(note.description).toBe('desc');
    expect(note.tags).toEqual(['x']);
    expect(note.type).toBe('snippet');
    expect(note.content).toBe('line one\nline two');
  });

  it('refuses to overwrite a note changed after the form was opened', async () => {
    const id = await createNote('Original', 'old content');
    const res = await post(`/ui/notes/${id}`, {
      updated: '2000-01-01T00:00:00.000Z',
      title: 'Mine',
      content: 'my content',
    });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('my content');

    const note = (await (await get(`/notes/${id}`)).json()).data;
    expect(note.content).toBe('old content');
  });

  it('refuses a stale edit whose body arrives after another save', async () => {
    const id = await createNote('Original', 'old content');
    const form = await (await get(`/ui/notes/${id}/edit`)).text();
    const updated = form.match(/name="updated" value="([^"]+)"/)![1];

    // Start a POST and hold back most of its body
    const slowBody = new URLSearchParams({
      updated,
      title: 'Slow',
      content: 'slow edit',
    }).toString();
    const { port } = server.address() as { port: number };
    const slowReq = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: `/ui/notes/${id}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(slowBody),
      },
    });
    const slowStatus = new Promise<number>((resolve, reject) => {
      slowReq.on('response', (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      slowReq.on('error', reject);
    });
    slowReq.write(slowBody.slice(0, 10));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const fast = await post(`/ui/notes/${id}`, {
      updated,
      title: 'Fast',
      content: 'fast edit',
    });
    expect(fast.status).toBe(303);

    slowReq.end(slowBody.slice(10));
    expect(await slowStatus).toBe(409);

    const note = (await (await get(`/notes/${id}`)).json()).data;
    expect(note.content).toBe('fast edit');
  });

  it('returns 404 for an unknown id instead of a search hit', async () => {
    await createNote('Some note', 'unrelated content');
    expect((await get('/ui/notes/Some%20note')).status).toBe(404);
    expect((await get('/ui/notes/unrelated/edit')).status).toBe(404);
    const res = await post('/ui/notes/unrelated', {
      title: 'x',
      content: 'y',
    });
    expect(res.status).toBe(404);
  });

  it('deletes a note', async () => {
    const id = await createNote('Doomed', 'bye');
    const res = await post(`/ui/notes/${id}/delete`, {});
    expect(res.status).toBe(303);
    expect((await get(`/notes/${id}`)).status).toBe(404);
  });

  it('rejects cross-origin posts', async () => {
    const res = await post(
      '/ui/new',
      { title: 'Evil', content: 'x' },
      { Origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
  });
});

describe('web UI archive', () => {
  beforeEach(() => start());

  it('archives a note out of the list and search', async () => {
    const id = await createNote('Dusty Note', 'cobweb text');
    const page = await (await get(`/ui/notes/${id}`)).text();
    expect(page).toContain(`action="/ui/notes/${id}/archive"`);

    const res = await post(`/ui/notes/${id}/archive`, {});
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/ui/notes/${id}`);

    expect(await (await get('/ui')).text()).not.toContain('Dusty Note');
    expect(await (await get('/ui?q=cobweb')).text()).not.toContain(
      'Dusty Note',
    );

    const archived = await (await get('/ui?archived=only')).text();
    expect(archived).toContain('Archived notes');
    expect(archived).toContain('Dusty Note');
    expect(await (await get('/ui?q=cobweb&archived=only')).text()).toContain(
      'Dusty Note',
    );
    expect(
      await (await get(`/ui?q=${encodeURIComponent('is:archived')}`)).text(),
    ).toContain('Dusty Note');

    const note = await (await get(`/ui/notes/${id}`)).text();
    expect(note).toContain('<span class="label">archived</span>');
    expect(note).toContain(`action="/ui/notes/${id}/unarchive"`);
  });

  it('unarchives a note', async () => {
    const id = await createNote('Revived Note', 'back again');
    await post(`/ui/notes/${id}/archive`, {});
    const res = await post(`/ui/notes/${id}/unarchive`, {});
    expect(res.status).toBe(303);
    expect(await (await get('/ui')).text()).toContain('Revived Note');
  });

  it('returns 404 when archiving a missing note', async () => {
    const res = await post(
      '/ui/notes/00000000-0000-0000-0000-000000000000/archive',
      {},
    );
    expect(res.status).toBe(404);
  });
});

describe('web UI with token', () => {
  beforeEach(() => start(PASSPHRASE));

  async function login(): Promise<string> {
    const res = await post('/ui/login', {
      passphrase: PASSPHRASE,
      next: '/ui',
    });
    expect(res.status).toBe(303);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    return cookie.split(';')[0];
  }

  it('redirects to login when not logged in', async () => {
    const res = await get('/ui/notes/abc?x=1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `/ui/login?next=${encodeURIComponent('/ui/notes/abc?x=1')}`,
    );
  });

  it('sets Secure on the cookie only when the browser used https', async () => {
    const plain = await post('/ui/login', { passphrase: PASSPHRASE });
    expect(plain.headers.get('set-cookie')).not.toContain('Secure');

    const viaProxy = await post(
      '/ui/login',
      { passphrase: PASSPHRASE },
      { 'X-Forwarded-Proto': 'https' },
    );
    expect(viaProxy.headers.get('set-cookie')).toContain('Secure');
  });

  it('rejects a wrong passphrase', async () => {
    const res = await post('/ui/login', { passphrase: 'nope' });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('gives access after login', async () => {
    const cookie = await login();
    const id = await createNote('Private', 'secret stuff', { Cookie: cookie });
    const html = await (
      await get(`/ui/notes/${id}`, { Cookie: cookie })
    ).text();
    expect(html).toContain('secret stuff');
  });

  it('rejects a forged session cookie', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const res = await get('/ui', { Cookie: `mor_session=${exp}.forged` });
    expect(res.status).toBe(302);
  });

  it('only redirects to /ui paths after login', async () => {
    const res = await post('/ui/login', {
      passphrase: PASSPHRASE,
      next: 'https://evil.example/',
    });
    expect(res.headers.get('location')).toBe('/ui');
  });

  it('does not let the session cookie reach the JSON API', async () => {
    const cookie = await login();
    const res = await get('/notes', { Cookie: cookie });
    expect(res.status).toBe(401);
  });

  it('logs out', async () => {
    const cookie = await login();
    const res = await post('/ui/logout', {}, { Cookie: cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
