import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const REGISTERED = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, java, javascript, json, kotlin,
  markdown, php, python, ruby, rust, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(REGISTERED)) hljs.registerLanguage(name, lang);

export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'plaintext', label: 'Plain text' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'bash', label: 'Shell' },
  { id: 'sql', label: 'SQL' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'css', label: 'CSS' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'diff', label: 'Diff' },
  { id: 'dockerfile', label: 'Dockerfile' },
];

const ALIASES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  py: 'python', python3: 'python', rb: 'ruby', rs: 'rust', golang: 'go', kt: 'kotlin', kts: 'kotlin',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellsession: 'bash', fish: 'bash',
  yml: 'yaml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
  scss: 'css', less: 'css', md: 'markdown', patch: 'diff', docker: 'dockerfile',
  'c++': 'cpp', cc: 'cpp', hpp: 'cpp', h: 'c', cs: 'csharp', 'c#': 'csharp',
  text: 'plaintext', txt: 'plaintext', plain: 'plaintext', log: 'plaintext',
};

export function normalizeLanguage(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const key = lang.toLowerCase();
  if (key in REGISTERED || key === 'plaintext') return key;
  return ALIASES[key];
}

export function languageLabel(id: string) {
  return LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

export function detectLanguage(code: string, filename?: string): string {
  if (filename) {
    if (/^dockerfile$/i.test(filename)) return 'dockerfile';
    const fromExt = normalizeLanguage(filename.split('.').pop());
    if (fromExt) return fromExt;
  }
  if (!code.trim()) return 'plaintext';
  // Cheap signals that short snippets give away better than statistical detection.
  for (const [re, lang] of HINTS) if (re.test(code)) return lang;
  const result = hljs.highlightAuto(code, Object.keys(REGISTERED));
  return result.language && result.relevance >= 2 ? result.language : 'plaintext';
}

/** A line that starts like a terminal command. */
export const SHELL_LINE =
  /^\s*(\$ )?(npm|npx|yarn|pnpm|bun|node|deno|git|cd|ls|curl|wget|docker|kubectl|helm|brew|pip3?|python3?|cargo|go (run|build|test|mod|get)|make|sudo|chmod|mkdir|rm -|grep|ssh|tar)\s/m;

// Order matters: first match wins.
const HINTS: [RegExp, string][] = [
  [/^\s*diff --git |^@@ -\d+(,\d+)? \+\d+/m, 'diff'],
  [/^\s*(SELECT .+ FROM|INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE (TABLE|INDEX|VIEW)|ALTER TABLE|WITH \w+ AS \()/m, 'sql'],
  [/^\s*(def \w+\(.*\)\s*(->.*)?:|from [\w.]+ import |import \w+$|if __name__ == |print\(f?["'])/m, 'python'],
  [/^\s*(package \w+$|func (\(\w+ \*?\w+\) )?\w+\(.*\)[^{]*\{|\w+ := |fmt\.\w+\()/m, 'go'],
  [/^\s*(fn \w+|let mut |impl\b|use \w+::|println!\()/m, 'rust'],
  [/^\s*(public|private|protected) (static )?(final )?(class|void|interface|enum|[A-Z]\w*(<.*>)? \w+\()|System\.out\./m, 'java'],
  [/^\s*(FROM \S+( AS \w+)?$|RUN |COPY |ENTRYPOINT |CMD \[)/m, 'dockerfile'],
  [/^\s*(apiVersion|kind|metadata|spec):/m, 'yaml'],
  [/[\w)]: *(string|number|boolean|void|unknown|any|never)\b|^\s*(export )?(interface|type) \w+.*[={]|\bas const\b|<\w+>\(/m, 'typescript'],
  [/\b(console\.\w+|document\.|require\(|module\.exports)|^\s*(export )?(const|let|var) \w+ = |=> /m, 'javascript'],
  [SHELL_LINE, 'bash'],
];

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Returns highlighted HTML. Output is produced by highlight.js, which escapes the source. */
export function highlight(code: string, language: string): string {
  if (!hljs.getLanguage(language)) return escapeHtml(code);
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

/** Remove indentation shared by every non-blank line, plus leading/trailing blank lines. */
export function dedent(text: string): string {
  const lines = text.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min).trimEnd()).join('\n');
}
