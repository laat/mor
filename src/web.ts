import crypto from 'node:crypto';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Marked } from 'marked';
import { NotFoundError } from './operations-local.js';
import { NOTE_TYPES } from './operations.js';
import type { Note, NoteFilter, NoteType, Operations } from './operations.js';
import { escapeHtml } from './utils/html.js';
import { wrapCodeFence } from './utils/markdown.js';
import { timingSafeCompare } from './utils/net.js';

const COOKIE = 'mor_session';
const SESSION_TTL = 30 * 24 * 60 * 60;
const PAGE_SIZE = 50;

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: https:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

// Raw HTML in notes is shown as text, and mor: links point at the UI.
const markdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
  walkTokens(token) {
    if (token.type === 'link' && token.href.startsWith('mor:')) {
      token.href = `/ui/notes/${encodeURIComponent(token.href.slice(4))}`;
    }
  },
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Session cookies are `<expiry>.<hmac>`, keyed by the passphrase, so they
 * survive restarts and stop working when the passphrase changes.
 */
function signSession(passphrase: string, exp: number): string {
  return crypto
    .createHmac('sha256', passphrase)
    .update(`mor-web:${exp}`)
    .digest('base64url');
}

function createSession(passphrase: string): string {
  const exp = nowSec() + SESSION_TTL;
  return `${exp}.${signSession(passphrase, exp)}`;
}

export function verifySession(
  passphrase: string,
  value: string | undefined,
): boolean {
  if (!value) return false;
  const [expStr, sig] = value.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isInteger(exp) || exp < nowSec()) return false;
  return timingSafeCompare(sig, signSession(passphrase, exp));
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether the browser used HTTPS. Behind a TLS-terminating proxy the
 * request URL is http, so prefer the proxy header and the Origin.
 */
function isHttps(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0].trim();
  if (forwarded) return forwarded === 'https';
  const url = parseUrl(c.req.header('origin') ?? c.req.url);
  return url?.protocol === 'https:';
}

/** Reject cross-site form posts (CSRF). */
const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const site = c.req.header('sec-fetch-site');
    const origin = c.req.header('origin');
    const crossSite = site
      ? site !== 'same-origin' && site !== 'none'
      : origin !== undefined && parseUrl(origin)?.host !== c.req.header('host');
    if (crossSite) return c.text('Forbidden: cross-origin request', 403);
  }
  await next();
};

function safeNext(next: string | undefined): string {
  return next && /^\/ui(\/|\?|$)/.test(next) ? next : '/ui';
}

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v.replace(/\r\n/g, '\n') : '';
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseType(raw: string): NoteType | undefined {
  return (NOTE_TYPES as readonly string[]).includes(raw)
    ? (raw as NoteType)
    : undefined;
}

function noteUrl(id: string): string {
  return `/ui/notes/${encodeURIComponent(id)}`;
}

function renderContent(note: Note): string {
  return markdown.parse(wrapCodeFence(note.content, note.filePath), {
    async: false,
  });
}

// Colours and look from galley (github.com/laat/galley, public/app.css):
// Primer's tokens tinted blue, with T3 Code's neutrals in the dark theme.
const STYLE = `
  :root {
    color-scheme: light;
    --fg: #1f2328; --fg-muted: #59636e; --fg-on-emphasis: #ffffff;
    --bg: #f8fbff; --bg-subtle: #f1f7ff; --header-bg: #d4e5fb;
    --border: #cdd9e8; --border-muted: #cdd9e8b3;
    --accent: #0969da; --accent-emphasis: #0969da; --accent-subtle: #ddf4ff;
    --danger: #d1242f; --danger-emphasis: #cf222e; --danger-subtle: #ffebe9;
    --neutral-muted: #818b981f;
    --btn-bg: #f1f7ff; --btn-hover: #e9f1fc; --btn-border: #cdd9e8;
    --btn-primary-bg: #1f883d; --btn-primary-hover: #1c8139;
    --shadow: 0 1px 0 #1f23280a;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --fg: #e4e4ea; --fg-muted: #a0a5b0;
      --bg: #17212b; --bg-subtle: #1e2a35; --header-bg: #202f3d;
      --border: #2e3e4c; --border-muted: #2e3e4cb3;
      --accent: #7fb4e0; --accent-emphasis: #4f7ea6; --accent-subtle: #253b4d;
      --danger: #f85149; --danger-emphasis: #da3633; --danger-subtle: #f851491a;
      --neutral-muted: #656c7633;
      --btn-bg: #233444; --btn-hover: #2a3d4f; --btn-border: #2e4051;
      --btn-primary-bg: #238636; --btn-primary-hover: #29903b;
      --shadow: none;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--font); font-size: 14px; line-height: 1.5;
    color: var(--fg); background: var(--bg); -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: var(--mono); }
  header { background: var(--header-bg); border-bottom: 1px solid var(--border);
    padding: 8px 24px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header .brand { color: var(--fg); font-weight: 600; font-size: 16px; }
  header form.search { flex: 1; min-width: 12rem; display: flex; gap: 8px; }
  main { max-width: 1012px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 24px; font-weight: 600; margin: 0 0 8px; }
  input, select, textarea { padding: 5px 12px; font: inherit; line-height: 20px;
    color: var(--fg); background: var(--bg); border: 1px solid var(--border);
    border-radius: 6px; }
  input:focus, select:focus, textarea:focus { outline: none;
    border-color: var(--accent-emphasis); box-shadow: inset 0 0 0 1px var(--accent-emphasis); }
  header input { flex: 1; }
  textarea { width: 100%; min-height: 60vh; resize: vertical; font-family: var(--mono);
    font-size: 13px; }
  label { display: block; font-weight: 600; margin: 16px 0 6px; }
  form.edit input[type="text"] { width: 100%; }
  button, .button { display: inline-flex; align-items: center; height: 32px;
    padding: 0 12px; font: inherit; font-weight: 500; white-space: nowrap;
    color: var(--fg-on-emphasis); background: var(--btn-primary-bg);
    border: 1px solid #1f232826; border-radius: 6px; box-shadow: var(--shadow);
    cursor: pointer; text-decoration: none !important; }
  button:hover, .button:hover { background: var(--btn-primary-hover); }
  button.secondary, .button.secondary { color: var(--fg); background: var(--btn-bg);
    border-color: var(--btn-border); }
  button.secondary:hover, .button.secondary:hover { background: var(--btn-hover); }
  button.danger { color: var(--danger); background: var(--btn-bg); border-color: var(--btn-border); }
  button.danger:hover { color: #fff; background: var(--danger-emphasis);
    border-color: var(--danger-emphasis); }
  .actions { display: flex; gap: 8px; margin: 16px 0; align-items: center; }
  .meta { font-size: 12px; color: var(--fg-muted); }
  .tag { display: inline-block; padding: 0 7px; font-size: 12px; font-weight: 500;
    line-height: 18px; border-radius: 2em; color: var(--accent);
    background: var(--accent-subtle); }
  .error { color: var(--fg); background: var(--danger-subtle);
    border: 1px solid var(--danger); border-radius: 6px; padding: 8px 16px; }
  ul.notes { list-style: none; padding: 0; margin: 16px 0;
    border: 1px solid var(--border); border-radius: 6px; }
  ul.notes li { padding: 8px 16px; border-top: 1px solid var(--border-muted); }
  ul.notes li:first-child { border-top: 0; }
  ul.notes li:hover { background: var(--bg-subtle); }
  ul.notes li > a { color: var(--fg); font-weight: 600; font-size: 16px; }
  ul.notes li > a:hover { color: var(--accent); }
  ul.notes .desc { color: var(--fg-muted); }
  .content { word-wrap: break-word; }
  .content > :first-child { margin-top: 0; }
  .content :is(p, blockquote, ul, ol, table, pre) { margin: 0 0 16px; }
  .content :is(h1, h2, h3, h4, h5, h6) { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
  .content :is(h1, h2) { padding-bottom: 0.3em; border-bottom: 1px solid var(--border-muted); }
  .content h1 { font-size: 2em; }
  .content h2 { font-size: 1.5em; }
  .content h3 { font-size: 1.25em; }
  .content :is(ul, ol) { padding-left: 2em; }
  .content blockquote { padding: 0 1em; color: var(--fg-muted); border-left: 0.25em solid var(--border); }
  .content code { padding: 0.2em 0.4em; font-size: 85%; background: var(--neutral-muted);
    border-radius: 6px; }
  .content pre { padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45;
    background: var(--bg-subtle); border-radius: 6px; }
  .content pre code { padding: 0; font-size: 100%; background: transparent; }
  .content table { display: block; width: max-content; max-width: 100%; overflow: auto;
    border-collapse: collapse; }
  .content :is(th, td) { padding: 6px 13px; border: 1px solid var(--border); }
  .content tr:nth-child(2n) { background: var(--bg-subtle); }
  .content hr { height: 0.25em; margin: 24px 0; background: var(--border); border: 0; }
  .content img { max-width: 100%; }
  .card { background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 6px;
    padding: 24px; max-width: 340px; margin: 15vh auto 0; }
  .card h1 { text-align: center; }
  .card input { width: 100%; }
  .card button { margin-top: 16px; width: 100%; justify-content: center; }
`;

function layout(
  title: string,
  body: string,
  opts: { q?: string; auth: boolean },
): string {
  const logout = opts.auth
    ? `<form method="POST" action="/ui/logout"><button class="secondary" type="submit">Log out</button></form>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — mor</title>
  <style>${STYLE}</style>
</head>
<body>
  <header>
    <a class="brand" href="/ui">mor</a>
    <form class="search" method="GET" action="/ui">
      <input type="search" name="q" placeholder="Search notes" value="${escapeHtml(opts.q ?? '')}">
      <button class="secondary" type="submit">Search</button>
    </form>
    <a class="button" href="/ui/new">New note</a>
    ${logout}
  </header>
  <main>
${body}
  </main>
</body>
</html>`;
}

function loginHtml(next: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mor — Log in</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="card">
    <h1>mor</h1>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="/ui/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <label for="passphrase">Passphrase</label>
      <input type="password" id="passphrase" name="passphrase" autocomplete="current-password" autofocus required>
      <button type="submit">Log in</button>
    </form>
  </div>
</body>
</html>`;
}

function tagsHtml(tags: string[]): string {
  return tags
    .map(
      (t) =>
        `<a class="tag" href="/ui?tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`,
    )
    .join(' ');
}

function metaHtml(note: Note): string {
  const parts = [
    escapeHtml(note.type),
    `updated ${escapeHtml(note.updated.slice(0, 10))}`,
  ];
  if (note.repository) parts.push(escapeHtml(note.repository));
  const tags = note.tags.length ? ` · ${tagsHtml(note.tags)}` : '';
  return `<div class="meta">${parts.join(' · ')}${tags}</div>`;
}

function noteListHtml(notes: Note[]): string {
  if (notes.length === 0) return '<p>No notes found.</p>';
  const items = notes.map(
    (n) => `<li>
      <a href="${noteUrl(n.id)}">${escapeHtml(n.title)}</a>
      ${n.description ? `<div class="desc">${escapeHtml(n.description)}</div>` : ''}
      ${metaHtml(n)}
    </li>`,
  );
  return `<ul class="notes">${items.join('\n')}</ul>`;
}

function linkListHtml(
  heading: string,
  links: Array<{ id: string; title: string }>,
): string {
  if (links.length === 0) return '';
  const items = links
    .map(
      (l) => `<li><a href="${noteUrl(l.id)}">${escapeHtml(l.title)}</a></li>`,
    )
    .join('');
  return `<h3>${heading}</h3><ul>${items}</ul>`;
}

interface FormValues {
  title: string;
  description: string;
  tags: string;
  type: string;
  content: string;
}

function noteFormHtml(opts: {
  action: string;
  values: FormValues;
  updated?: string;
  submit: string;
  cancel: string;
  error?: string;
}): string {
  const { values } = opts;
  const options = NOTE_TYPES.map(
    (t) =>
      `<option value="${t}"${t === values.type ? ' selected' : ''}>${t}</option>`,
  ).join('');
  return `${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ''}
    <form class="edit" method="POST" action="${escapeHtml(opts.action)}">
      ${opts.updated ? `<input type="hidden" name="updated" value="${escapeHtml(opts.updated)}">` : ''}
      <label for="title">Title</label>
      <input type="text" id="title" name="title" value="${escapeHtml(values.title)}" required>
      <label for="description">Description</label>
      <input type="text" id="description" name="description" value="${escapeHtml(values.description)}">
      <label for="tags">Tags (comma separated)</label>
      <input type="text" id="tags" name="tags" value="${escapeHtml(values.tags)}">
      <label for="type">Type</label>
      <select id="type" name="type">${options}</select>
      <label for="content">Content</label>
      <textarea id="content" name="content" required>${escapeHtml(values.content)}</textarea>
      <div class="actions">
        <button type="submit">${escapeHtml(opts.submit)}</button>
        <a class="button secondary" href="${escapeHtml(opts.cancel)}">Cancel</a>
      </div>
    </form>`;
}

function formValues(body: Record<string, unknown>): FormValues {
  return {
    title: str(body, 'title').trim(),
    description: str(body, 'description').trim(),
    tags: str(body, 'tags'),
    type: str(body, 'type'),
    content: str(body, 'content'),
  };
}

/**
 * Browser UI for reading and editing notes, mounted at /ui.
 * With a passphrase, a login form issues a signed session cookie.
 */
export function createWebRoutes(ops: Operations, passphrase?: string): Hono {
  const web = new Hono();
  const auth = passphrase !== undefined;

  const render = (
    c: Context,
    title: string,
    body: string,
    status: ContentfulStatusCode = 200,
  ) => c.html(layout(title, body, { q: c.req.query('q'), auth }), status);

  // Note URLs carry ids (full, or a short prefix as in mor: links); ops.read
  // alone would fall back to search and show an unrelated note for a stale
  // or mistyped id.
  const readNote = async (id: string) => {
    const want = id.toLowerCase();
    const note = await ops.read(want);
    return note &&
      (note.id === want || (want.length >= 8 && note.id.startsWith(want)))
      ? note
      : undefined;
  };

  // Serializes edits so the version check and the write cannot interleave
  // with another edit.
  let editQueue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = editQueue.then(fn, fn);
    editQueue = run.catch(() => {});
    return run;
  };

  const notFound = (c: Context) =>
    render(c, 'Not found', '<h1>Not found</h1><p>No such note.</p>', 404);

  web.use(async (c, next) => {
    await next();
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
  });

  web.use(sameOrigin);

  web.get('/login', (c) => {
    const next = safeNext(c.req.query('next'));
    if (!auth) return c.redirect(next);
    return c.html(loginHtml(next));
  });

  web.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const next = safeNext(str(body, 'next'));
    if (!auth) return c.redirect(next);
    if (!timingSafeCompare(str(body, 'passphrase'), passphrase)) {
      return c.html(loginHtml(next, 'Wrong passphrase.'), 401);
    }
    setCookie(c, COOKIE, createSession(passphrase), {
      path: '/ui',
      httpOnly: true,
      sameSite: 'Strict',
      secure: isHttps(c),
      maxAge: SESSION_TTL,
    });
    return c.redirect(next, 303);
  });

  web.use(async (c, next) => {
    if (!auth || verifySession(passphrase, getCookie(c, COOKIE))) {
      return next();
    }
    if (c.req.method === 'GET') {
      const url = new URL(c.req.url);
      const target = encodeURIComponent(url.pathname + url.search);
      return c.redirect(`/ui/login?next=${target}`);
    }
    return c.redirect('/ui/login', 303);
  });

  web.post('/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/ui' });
    return c.redirect('/ui/login', 303);
  });

  web.get('/', async (c) => {
    const q = c.req.query('q')?.trim();
    const tag = c.req.query('tag');
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);
    const filter: NoteFilter | undefined = tag ? { tag: [tag] } : undefined;

    let notes: Note[];
    let total: number;
    if (q) {
      const page = await ops.search(q, PAGE_SIZE, filter, offset);
      notes = page.data.map((r) => r.note);
      total = page.total;
    } else {
      const page = await ops.list(filter, PAGE_SIZE, offset);
      notes = page.data;
      total = page.total;
    }

    const pageUrl = (o: number) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (tag) params.set('tag', tag);
      if (o > 0) params.set('offset', String(o));
      const s = params.toString();
      return s ? `/ui?${s}` : '/ui';
    };
    const pager = [
      offset > 0
        ? `<a href="${escapeHtml(pageUrl(Math.max(0, offset - PAGE_SIZE)))}">← Previous</a>`
        : '',
      offset + PAGE_SIZE < total
        ? `<a href="${escapeHtml(pageUrl(offset + PAGE_SIZE))}">Next →</a>`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const heading = q
      ? `Search: ${escapeHtml(q)}`
      : tag
        ? `Tag: ${escapeHtml(tag)}`
        : 'Notes';
    const count = total
      ? `<p class="meta">${offset + 1}–${offset + notes.length} of ${total}</p>`
      : '';
    return render(
      c,
      q || tag || 'Notes',
      `<h1>${heading}</h1>${count}${noteListHtml(notes)}<div class="actions">${pager}</div>`,
    );
  });

  web.get('/new', (c) =>
    render(
      c,
      'New note',
      `<h1>New note</h1>${noteFormHtml({
        action: '/ui/new',
        values: {
          title: '',
          description: '',
          tags: '',
          type: 'knowledge',
          content: '',
        },
        submit: 'Create',
        cancel: '/ui',
      })}`,
    ),
  );

  web.post('/new', async (c) => {
    const values = formValues(await c.req.parseBody());
    if (!values.title || !values.content.trim()) {
      return render(
        c,
        'New note',
        `<h1>New note</h1>${noteFormHtml({
          action: '/ui/new',
          values,
          submit: 'Create',
          cancel: '/ui',
          error: 'Title and content are required.',
        })}`,
        400,
      );
    }
    const note = await ops.add({
      title: values.title,
      description: values.description || undefined,
      content: values.content,
      tags: parseTags(values.tags),
      type: parseType(values.type),
    });
    return c.redirect(noteUrl(note.id), 303);
  });

  web.get('/notes/:id', async (c) => {
    const note = await readNote(c.req.param('id'));
    if (!note) return notFound(c);
    const links = await ops.getLinks(note.id);
    return render(
      c,
      note.title,
      `<h1>${escapeHtml(note.title)}</h1>
      ${metaHtml(note)}
      ${note.description ? `<p><em>${escapeHtml(note.description)}</em></p>` : ''}
      <div class="actions">
        <a class="button" href="${noteUrl(note.id)}/edit">Edit</a>
        <a class="button secondary" href="${noteUrl(note.id)}/delete">Delete</a>
      </div>
      <div class="content">${renderContent(note)}</div>
      ${linkListHtml('Links to', links.forward)}
      ${linkListHtml('Linked from', links.back)}
      <p class="meta">${escapeHtml(note.id)}</p>`,
    );
  });

  web.get('/notes/:id/edit', async (c) => {
    const note = await readNote(c.req.param('id'));
    if (!note) return notFound(c);
    return render(
      c,
      `Edit ${note.title}`,
      `<h1>Edit</h1>${noteFormHtml({
        action: noteUrl(note.id),
        values: {
          title: note.title,
          description: note.description ?? '',
          tags: note.tags.join(', '),
          type: note.type,
          content: note.content,
        },
        updated: note.updated,
        submit: 'Save',
        cancel: noteUrl(note.id),
      })}`,
    );
  });

  web.post('/notes/:id', async (c) => {
    // Read the body first: the version check below must see the note as it
    // is when the edit is written, not as it was when the request started.
    const body = await c.req.parseBody();
    const values = formValues(body);

    return exclusive(async () => {
      const note = await readNote(c.req.param('id'));
      if (!note) return notFound(c);

      const formError = (error: string) =>
        render(
          c,
          `Edit ${note.title}`,
          `<h1>Edit</h1>${noteFormHtml({
            action: noteUrl(note.id),
            values,
            updated: note.updated,
            submit: 'Save',
            cancel: noteUrl(note.id),
            error,
          })}`,
          409,
        );

      if (str(body, 'updated') !== note.updated) {
        return formError(
          `This note was changed elsewhere (at ${note.updated}) after you opened it. ` +
            'Saving again will overwrite that change with your text below.',
        );
      }
      if (!values.title) return formError('Title is required.');

      await ops.update(note.id, {
        title: values.title,
        description: values.description,
        content: values.content,
        tags: parseTags(values.tags),
        type: parseType(values.type),
      });
      return c.redirect(noteUrl(note.id), 303);
    });
  });

  web.get('/notes/:id/delete', async (c) => {
    const note = await readNote(c.req.param('id'));
    if (!note) return notFound(c);
    return render(
      c,
      `Delete ${note.title}`,
      `<h1>Delete “${escapeHtml(note.title)}”?</h1>
      <form method="POST" action="${noteUrl(note.id)}/delete" class="actions">
        <button class="danger" type="submit">Delete</button>
        <a class="button secondary" href="${noteUrl(note.id)}">Cancel</a>
      </form>`,
    );
  });

  web.post('/notes/:id/delete', async (c) => {
    try {
      await ops.remove(c.req.param('id'));
    } catch (e) {
      if (e instanceof NotFoundError) return notFound(c);
      throw e;
    }
    return c.redirect('/ui', 303);
  });

  return web;
}
