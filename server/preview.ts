// Link preview endpoint: POST /api/preview { url } -> { title, description, image, ... }
// Shared by the Vite dev server (vite.config.ts) and the production server (server/index.ts).
// Kept dependency-free so it runs under Node's built-in TypeScript type stripping.

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface PreviewResult {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  /** Larger icon (apple-touch-icon etc.), shown as a banner when there's no image. */
  logo?: string;
  /** True when the site couldn't be read and this was guessed from the URL. */
  partial?: boolean;
  /** 'image': the picture is the point (e.g. a Pinterest pin); show it full, no text. */
  display?: 'image';
  github?: {
    kind: 'pull' | 'issue';
    state: 'open' | 'closed' | 'merged' | 'draft';
    repo: string;
    number: number;
  };
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const USER_AGENT = 'Mozilla/5.0 (compatible; CodeBoard/0.1; link preview)';
const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000;

export async function handlePreviewRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
    const body = JSON.parse(await readBody(req, 16_000)) as { url?: unknown };
    if (typeof body.url !== 'string') throw new HttpError(400, 'Missing "url"');
    send(res, 200, await getPreview(body.url));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 502;
    const message =
      err instanceof Error && err.name === 'TimeoutError' ? 'Timed out' : err instanceof Error ? err.message : String(err);
    send(res, status, { error: message });
  }
}

const MAX_IMAGE_BYTES = 6_000_000;

/**
 * POST /api/image { url } -> the image bytes. Lets the client save preview images
 * locally, so cards keep working when the remote image is rate-limited,
 * hotlink-protected or deleted.
 */
export async function handleImageRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
    const body = JSON.parse(await readBody(req, 16_000)) as { url?: unknown };
    if (typeof body.url !== 'string') throw new HttpError(400, 'Missing "url"');
    const url = new URL(body.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) images');

    const upstream = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/png,image/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok) throw new HttpError(502, `Image responded ${upstream.status}`);
    if (!type.startsWith('image/')) throw new HttpError(415, 'Not an image');
    const declared = Number(upstream.headers.get('content-length') ?? 0);
    if (declared > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image too large');

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image too large');
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(bytes);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    send(res, status, { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function getPreview(raw: string): Promise<PreviewResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) links are supported');

  // Sites with a public API, either richer than their HTML or behind a bot wall.
  // On failure (rate limit, private repo) fall through to the page's own meta tags.
  const gh = matchGithub(url);
  if (gh) {
    const result = await githubPreview(gh).catch(() => null);
    if (result) return result;
  }
  const so = url.hostname.match(/^(?:www\.)?stackoverflow\.com$/) && url.pathname.match(/^\/(?:questions|q)\/(\d+)/);
  if (so) {
    const result = await stackOverflowPreview(so[1]).catch(() => null);
    if (result) return result;
  }
  const npm = url.hostname.match(/^(?:www\.)?npmjs\.com$/) && url.pathname.match(/^\/package\/((?:@[^/]+\/)?[^/]+)/);
  if (npm) {
    const result = await npmPreview(decodeURIComponent(npm[1])).catch(() => null);
    if (result) return result;
  }

  try {
    return await htmlPreview(url);
  } catch (err) {
    // Bot walls (Cloudflare etc.) and flaky sites: a plain card beats an error.
    if (err instanceof HttpError && err.status === 502) {
      return url.hostname === 'github.com' ? githubBasicPreview(url) : basicPreview(url);
    }
    throw err;
  }
}

/** Best guess from the URL alone, e.g. medium.com/@x/smart-and-dumb-components-7ca2f9a7c7d0. */
function basicPreview(url: URL): PreviewResult {
  const host = url.hostname.replace(/^www\./, '');
  const slug = url.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
    .filter((s) => !/^\d+$/.test(s) && !s.startsWith('@'))
    .pop();
  const words = slug
    ?.replace(/\.[a-z]{2,5}$/i, '') // .html
    .replace(/[-_][0-9a-f]{8,}$/i, '') // trailing hash ids
    .replace(/[-_+]+/g, ' ')
    .trim();
  return {
    title: words ? words[0].toUpperCase() + words.slice(1) : host,
    siteName: host,
    favicon: new URL('/favicon.ico', url).href,
    partial: true,
  };
}

// ---------------------------------------------------------------- Stack Overflow & npm

async function stackOverflowPreview(id: string): Promise<PreviewResult | null> {
  const res = await fetch(`https://api.stackexchange.com/2.3/questions/${id}?site=stackoverflow`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    items?: { title: string; score: number; answer_count: number; is_answered: boolean; tags: string[] }[];
  };
  const q = j.items?.[0];
  if (!q) return null;
  const answers = `${q.answer_count} answer${q.answer_count === 1 ? '' : 's'}`;
  return {
    title: decodeEntities(q.title),
    description: `${q.score} votes · ${answers}${q.is_answered ? ' · answered' : ''} · ${q.tags.map((t) => `#${t}`).join(' ')}`,
    siteName: 'Stack Overflow',
    favicon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico',
    logo: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon@2.png',
  };
}

async function npmPreview(name: string): Promise<PreviewResult | null> {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { name: string; version: string; description?: string };
  return {
    title: j.name,
    description: j.description,
    siteName: `npm · v${j.version}`,
    favicon: 'https://static-production.npmjs.com/b0f1a8318363185cc2ea6a40ac23eeb2.png',
    logo: 'https://static-production.npmjs.com/58a19602036db1daee0d7863c94673a4.png',
  };
}

// ---------------------------------------------------------------- GitHub

interface GithubRef {
  owner: string;
  repo: string;
  kind: 'pull' | 'issue';
  number: number;
}

const GITHUB_FAVICON = 'https://github.githubassets.com/favicons/favicon.svg';
const GITHUB_LOGO = 'https://github.githubassets.com/assets/apple-touch-icon-180x180-a80b8e11abe2.png';

const GITHUB_SECTIONS: Record<string, string> = {
  pull: 'PR', pulls: 'Pull requests', issues: 'Issue', commit: 'Commit', commits: 'Commits',
  blob: 'File', tree: 'Folder', discussions: 'Discussion', actions: 'Actions', releases: 'Releases',
  compare: 'Compare', wiki: 'Wiki',
};

/**
 * Private repos (and anything GitHub won't show us without a login) return a 404 page.
 * Build a readable card from the URL itself, e.g. "traefik/hub · PR #3".
 */
function githubBasicPreview(url: URL): PreviewResult {
  const [owner, repo, section, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let title = [owner, repo].filter(Boolean).join('/') || 'GitHub';
  const label = section ? GITHUB_SECTIONS[section] : undefined;
  if (label && rest[0]) {
    const ref = /^\d+$/.test(rest[0]) ? `#${rest[0]}` : section === 'commit' ? rest[0].slice(0, 7) : rest.slice(1).join('/') || rest[0];
    title += ` · ${label} ${ref}`;
  } else if (label) {
    title += ` · ${label}`;
  }
  return {
    title,
    description: process.env.GITHUB_TOKEN ? undefined : 'Private or not found. Start CodeBoard with npm run dev:github to preview private repos.',
    siteName: 'GitHub',
    favicon: GITHUB_FAVICON,
    logo: GITHUB_LOGO,
    partial: true,
  };
}

function matchGithub(url: URL): GithubRef | null {
  if (url.hostname !== 'github.com') return null;
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], kind: m[3] === 'pull' ? 'pull' : 'issue', number: Number(m[4]) };
}

async function githubPreview({ owner, repo, kind, number }: GithubRef): Promise<PreviewResult | null> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const endpoint = kind === 'pull' ? 'pulls' : 'issues';
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/${endpoint}/${number}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    draft?: boolean;
    merged_at?: string | null;
    pull_request?: unknown;
    base?: { repo?: { private?: boolean } };
  };
  // /issues/N also resolves pull requests.
  const isPull = kind === 'pull' || !!j.pull_request;
  const state = j.merged_at ? 'merged' : j.draft && j.state === 'open' ? 'draft' : j.state;
  return {
    title: j.title,
    description: summarize(j.body ?? ''),
    siteName: `${owner}/${repo}`,
    favicon: GITHUB_FAVICON,
    logo: GITHUB_LOGO,
    // GitHub's social card renderer doesn't work for private repos.
    image: j.base?.repo?.private
      ? undefined
      : `https://opengraph.githubassets.com/1/${owner}/${repo}/${isPull ? 'pull' : 'issues'}/${number}`,
    github: { kind: isPull ? 'pull' : 'issue', state, repo: `${owner}/${repo}`, number },
  };
}

function summarize(markdown: string, max = 220) {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || undefined;
}

// ---------------------------------------------------------------- Generic HTML

async function htmlPreview(url: URL): Promise<PreviewResult> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      'Accept-Language': 'en',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const finalUrl = new URL(res.url || url.href);
  const host = finalUrl.hostname.replace(/^www\./, '');
  const contentType = res.headers.get('content-type') ?? '';
  const fileName = decodeURIComponent(finalUrl.pathname.split('/').pop() || '') || host;

  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(502, `${host} responded ${res.status}`);
  }
  if (contentType.startsWith('image/')) {
    await res.body?.cancel();
    return { title: fileName, image: finalUrl.href, siteName: host };
  }
  if (!/html|xml/i.test(contentType)) {
    await res.body?.cancel();
    return { title: fileName, siteName: host, favicon: new URL('/favicon.ico', finalUrl).href };
  }

  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim();
  const html = await readLimited(res, MAX_HTML_BYTES, charset);
  return parseHtml(html, finalUrl);
}

export function parseHtml(html: string, base: URL): PreviewResult {
  const meta = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(tag);
    const key = (a.property ?? a.name ?? a.itemprop)?.toLowerCase();
    if (key && a.content && !meta.has(key)) meta.set(key, decodeEntities(a.content).trim());
  }

  let icon: string | undefined;
  let touchIcon: string | undefined;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(tag);
    const rel = a.rel?.toLowerCase() ?? '';
    if (!a.href) continue;
    if (/\bapple-touch-icon\b/.test(rel)) touchIcon ??= a.href;
    else if (/\bicon\b/.test(rel)) icon ??= a.href;
    else if (rel === 'image_src') meta.set('image_src', a.href);
  }

  // No social image declared: take the first reasonably large <img> on the page
  // (declared width ≥ 200, skipping tracking pixels, sprites and avatars).
  let contentImage: string | undefined;
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attributes(tag);
    const src = a.src ?? a['data-src'];
    if (!src || src.startsWith('data:') || /pixel|spacer|sprite|avatar|badge|logo/i.test(src)) continue;
    if (Number(a.width) >= 200) {
      contentImage = src;
      break;
    }
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find(Boolean);
  const resolve = (href: string | undefined) => {
    if (!href) return undefined;
    try {
      return new URL(decodeEntities(href), base).href;
    } catch {
      return undefined;
    }
  };

  const title = pick('og:title', 'twitter:title') ?? (titleTag ? decodeEntities(titleTag).replace(/\s+/g, ' ').trim() : undefined);
  const description = pick('og:description', 'twitter:description', 'description');
  let image = resolve(
    pick('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src', 'image', 'image_src') ?? contentImage,
  );
  // Pinterest pins are all about the picture: show it full-size, and ask the
  // CDN for the 736px version instead of a thumbnail.
  const isPin = /(^|\.)pinterest\.[a-z.]+$/i.test(base.hostname) && /\/pin\//.test(base.pathname);
  if (isPin && image) image = image.replace(/\/(\d+x\d*|originals)\//, '/736x/');
  return {
    title: title || undefined,
    description: description ? (description.length > 300 ? `${description.slice(0, 299)}…` : description) : undefined,
    image,
    display: isPin && image ? 'image' : undefined,
    siteName: pick('og:site_name', 'application-name') ?? base.hostname.replace(/^www\./, ''),
    favicon: resolve(icon ?? touchIcon ?? '/favicon.ico'),
    logo: resolve(touchIcon),
  };
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// ---------------------------------------------------------------- IO helpers

async function readLimited(res: Response, maxBytes: number, charset?: string) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes.subarray(0, Math.min(total, maxBytes)));
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
