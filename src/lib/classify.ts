import type { NoteColor, NoteSize } from '../db';
import { dedent, normalizeLanguage, SHELL_LINE } from './code';

/** Something the user pasted or dropped, before it becomes a card. */
export type Incoming =
  | { kind: 'image'; file: Blob; name?: string }
  | { kind: 'textfile'; file: File }
  | { kind: 'link'; url: string }
  | { kind: 'code'; code: string; language?: string; title?: string }
  | { kind: 'note'; text: string; color?: NoteColor; size?: NoteSize };

const URL_RE = /^https?:\/\/[^\s<>"]+$/i;
const TEXT_FILE_RE =
  /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|env|log|csv|tsv|xml|html?|css|scss|less|[cm]?jsx?|[cm]?tsx?|py|rb|go|rs|java|kts?|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|gql|proto|tf|lua|dart|vue|svelte|diff|patch)$/i;

/** Read a clipboard/drop payload synchronously (the DataTransfer dies after the event). */
export function incomingFromTransfer(dt: DataTransfer): Incoming[] {
  const files = Array.from(dt.files);
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length) return images.map((file): Incoming => ({ kind: 'image', file, name: file.name }));

  const texts = files.filter(
    (f) =>
      f.size < 512_000 &&
      (f.type.startsWith('text/') || TEXT_FILE_RE.test(f.name) || /^(Dockerfile|Makefile)$/.test(f.name)),
  );
  if (texts.length) return texts.map((file): Incoming => ({ kind: 'textfile', file }));
  if (files.length) return []; // binary files we don't know how to show

  const uriList = dt
    .getData('text/uri-list')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .join('\n');
  return classifyText(dt.getData('text/plain') || uriList);
}

export function classifyText(raw: string): Incoming[] {
  const text = raw.replace(/\r\n?/g, '\n');
  const trimmed = text.trim();
  if (!trimmed) return [];

  // One or more bare URLs, one per line -> link cards.
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 20 && lines.every((l) => URL_RE.test(l))) {
    return lines.map((url): Incoming => ({ kind: 'link', url }));
  }

  // SVG markup (e.g. Figma's "Copy as SVG") -> an image card, not a code card.
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>][\s\S]*<\/svg>$/i.test(trimmed)) {
    return [{ kind: 'image', file: new Blob([trimmed], { type: 'image/svg+xml' }), name: 'pasted.svg' }];
  }

  // A fenced markdown block (agents love these) -> code card with its language.
  const fence = trimmed.match(/^```([\w#+.-]*)[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) return [{ kind: 'code', code: dedent(fence[2]), language: normalizeLanguage(fence[1]) }];

  if (looksLikeCode(text)) return [{ kind: 'code', code: dedent(text) }];
  return [{ kind: 'note', text: trimmed }];
}

const KEYWORD_LINE =
  /^\s*(import|export|const|let|var|function|async|await|def|class|return|elif|package|func|fn|pub|use|struct|impl|interface|enum|#include|#!\/|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|RUN|apiVersion:|kind:|@\w+)\b/m;

export function looksLikeCode(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return false;

  // JSON objects/arrays.
  const t = text.trim();
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return true;
    } catch {
      /* not JSON */
    }
  }

  let score = 0;
  if (/[{}();]\s*$/m.test(text)) score++;
  if (KEYWORD_LINE.test(text)) score++;
  if (/=>|->|::|===|!==|&&|\|\||:=|\+\+|<\/\w+>|\w+\(.*\)\s*[{:]/.test(text)) score++;
  const indented = lines.filter((l) => /^( {2,}|\t)\S/.test(l)).length;
  if (lines.length > 1 && indented >= Math.max(1, lines.length * 0.25)) score++;
  if (/^\s*\$ \S/m.test(text)) score += 2; // shell prompt
  if (lines.length <= 3 && SHELL_LINE.test(text) && !/[.?!]$/.test(t)) score += 2; // a pasted command
  if (/^<([a-z][\w-]*)[^>]*>[\s\S]*<\/\1>$/i.test(t)) score += 2; // an HTML/XML element
  if (/^[.#@]?[\w-][\w\s.#:>,-]*\{[^}]*:[^}]*\}/.test(t)) score += 2; // a CSS rule
  if (/^\s+at .+:\d+:\d+\)?$/m.test(text)) score += 2; // stack trace

  // Prose usually reads like sentences: many words, ends in punctuation.
  const prose = lines.filter((l) => l.trim().split(/\s+/).length >= 6 && /[.?!:,]$|^[-*] |\b(the|and|is|to|of)\b/i.test(l)).length;
  if (prose / lines.length > 0.5) score -= 2;

  return score >= 2;
}
