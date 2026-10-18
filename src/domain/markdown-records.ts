/**
 * Principle 1: Markdown is the source of truth.
 * App records store typed fields + rich notes serialized as a deterministic
 * Markdown document with YAML-style frontmatter.
 */

export function serializeRecordToMarkdown(params: {
  fields: Record<string, string | number | null>;
  notesMarkdown?: string;
}): string {
  const { fields, notesMarkdown = '' } = params;
  const sortedKeys = Object.keys(fields).sort();
  const lines = ['---'];
  for (const key of sortedKeys) {
    const val = fields[key];
    lines.push(`${key}: ${JSON.stringify(val ?? null)}`);
  }
  lines.push('---');
  lines.push('');
  if (notesMarkdown.trim().length > 0) {
    lines.push(notesMarkdown.trim());
  }
  return lines.join('\n');
}

export function parseMarkdownToRecord(markdown: string): {
  fields: Record<string, string | number | null>;
  notesMarkdown: string;
} {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith('---\n')) {
    return { fields: {}, notesMarkdown: markdown };
  }

  const endIdx = trimmed.indexOf('\n---', 4);
  if (endIdx === -1) {
    return { fields: {}, notesMarkdown: markdown };
  }

  const headerBlock = trimmed.slice(4, endIdx);
  const bodyBlock = trimmed.slice(endIdx + 4).replace(/^\r?\n+/, '');
  const fields: Record<string, string | number | null> = {};

  for (const line of headerBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    try {
      const parsed: unknown = JSON.parse(rawVal);
      if (
        typeof parsed === 'string' ||
        typeof parsed === 'number' ||
        parsed === null
      ) {
        fields[key] = parsed;
      } else {
        fields[key] = String(parsed);
      }
    } catch {
      fields[key] = rawVal;
    }
  }

  return { fields, notesMarkdown: bodyBlock };
}
