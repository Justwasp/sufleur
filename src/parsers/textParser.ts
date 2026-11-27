/**
 * Decodes raw bytes as UTF-8 first, falling back to Windows-1251 for legacy Cyrillic text files.
 */
export function decodeTextBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Check UTF-16 BOM
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return cleanLineEndings(new TextDecoder('utf-16le').decode(bytes.subarray(2)));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return cleanLineEndings(new TextDecoder('utf-16be').decode(bytes.subarray(2)));
    }
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return cleanLineEndings(decoded.replace(/^\uFEFF/, ''));
  } catch {
    try {
      const decoded = new TextDecoder('windows-1251').decode(bytes);
      return cleanLineEndings(decoded);
    } catch {
      return cleanLineEndings(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
    }
  }
}

export function cleanLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strips SRT / WebVTT cue headers, timestamps, and HTML cue tags into clean readable paragraphs.
 */
export function parseSubtitleText(raw: string): string {
  const lines = cleanLineEndings(raw).split('\n');
  const out: string[] = [];
  let inNoteBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      inNoteBlock = false;
      if (out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }
      continue;
    }
    if (/^WEBVTT/i.test(trimmed)) continue;
    if (/^NOTE\b/i.test(trimmed)) {
      inNoteBlock = true;
      continue;
    }
    if (inNoteBlock) continue;
    // Numeric cue index
    if (/^\d+$/.test(trimmed)) continue;
    // Timestamp line (SRT or VTT)
    if (/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->/.test(trimmed)) continue;

    // Strip inline VTT/SRT formatting tags like <i>, <c.color>, <v Speaker>
    const cleaned = trimmed.replace(/<[^>]+>/g, '').trim();
    if (cleaned) {
      out.push(cleaned);
    }
  }

  return cleanLineEndings(out.join('\n'));
}

/**
 * Converts Markdown into clean speakable prose while preserving paragraphs.
 */
export function parseMarkdownText(raw: string): string {
  const text = cleanLineEndings(raw)
    // Remove YAML frontmatter
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    // Remove code fence delimiters (keep inner text)
    .replace(/^```[^\n]*\n/gm, '')
    .replace(/^```\s*$/gm, '')
    // Convert images ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Convert links [label](url) -> label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Strip heading hashes and blockquote markers
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    // Strip bullet list dashes/asterisks
    .replace(/^\s*[-*+]\s+/gm, '')
    // Strip bold/italic/inline-code markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    // Strip horizontal rules
    .replace(/^\s*([-*_]){3,}\s*$/gm, '');

  return cleanLineEndings(text);
}
