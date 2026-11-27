import { cleanLineEndings } from './textParser';

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'TR',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'PRE',
]);

/**
 * Extracts readable paragraphs from an HTML string using DOMParser.
 */
export function parseHtmlText(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // Remove non-readable elements
  for (const el of doc.querySelectorAll('script, style, noscript, svg, template')) {
    el.remove();
  }

  const chunks: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.textContent ?? '';
      if (val) chunks.push(val);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    if (el.tagName === 'BR') {
      chunks.push('\n');
      return;
    }

    const isBlock = BLOCK_TAGS.has(el.tagName);
    if (isBlock) chunks.push('\n');
    for (const child of el.childNodes) {
      walk(child);
    }
    if (isBlock) chunks.push('\n');
  };

  walk(doc.body ?? doc.documentElement);

  const joined = chunks
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');

  return cleanLineEndings(joined);
}

const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'footer',
  'headerl',
  'headerr',
  'headerf',
  'footerl',
  'footerr',
  'footerf',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'themedata',
  'colorschememapping',
  'datastore',
  'xmlnstbl',
  'mmathPr',
]);

interface RtfGroupState {
  uc: number;
  skip: boolean;
}

/**
 * Pure-TypeScript RTF text extractor supporting Unicode (\uN) and CP1251/CP1252 hex (\'xx).
 */
export function parseRtfText(rawRtf: string): string {
  // Detect codepage from \ansicpgN or Cyrillic charset (\fcharset204)
  let codepage = 'windows-1252';
  const cpgMatch = /\\ansicpg(\d+)/.exec(rawRtf);
  if (cpgMatch) {
    if (cpgMatch[1] === '1251') codepage = 'windows-1251';
    else if (cpgMatch[1] === '1252') codepage = 'windows-1252';
  } else if (/\\fcharset204\b/.test(rawRtf)) {
    codepage = 'windows-1251';
  }

  let hexDecoder: TextDecoder;
  try {
    hexDecoder = new TextDecoder(codepage);
  } catch {
    hexDecoder = new TextDecoder('windows-1252');
  }

  const stack: RtfGroupState[] = [{ uc: 1, skip: false }];
  const out: string[] = [];
  let hexBuffer: number[] = [];

  const flushHex = () => {
    if (hexBuffer.length > 0) {
      out.push(hexDecoder.decode(new Uint8Array(hexBuffer)));
      hexBuffer = [];
    }
  };

  let i = 0;
  const len = rawRtf.length;

  while (i < len) {
    const ch = rawRtf[i];
    const current = stack[stack.length - 1];

    if (ch === '{') {
      flushHex();
      stack.push({ uc: current.uc, skip: current.skip });
      i++;
      continue;
    }

    if (ch === '}') {
      flushHex();
      if (stack.length > 1) stack.pop();
      i++;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }

    if (ch === '\\') {
      i++;
      if (i >= len) break;
      const next = rawRtf[i];

      // Ignorable destination marker \*
      if (next === '*') {
        flushHex();
        current.skip = true;
        i++;
        continue;
      }

      // Escaped literal characters
      if (next === '\\' || next === '{' || next === '}') {
        flushHex();
        if (!current.skip) out.push(next);
        i++;
        continue;
      }

      // Non-breaking space or optional hyphen
      if (next === '~') {
        flushHex();
        if (!current.skip) out.push(' ');
        i++;
        continue;
      }
      if (next === '_' || next === '-') {
        flushHex();
        if (!current.skip) out.push('-');
        i++;
        continue;
      }
      if (next === '\r' || next === '\n') {
        flushHex();
        if (!current.skip) out.push('\n');
        i++;
        continue;
      }

      // Hex escape \'xx
      if (next === "'" && i + 2 < len) {
        const hex = rawRtf.slice(i + 1, i + 3);
        const byte = Number.parseInt(hex, 16);
        if (!Number.isNaN(byte) && !current.skip) {
          hexBuffer.push(byte);
        }
        i += 3;
        continue;
      }

      // Control word: [a-zA-Z]+ optionally followed by signed integer
      if (/[a-zA-Z]/.test(next)) {
        flushHex();
        const wordStart = i;
        while (i < len && /[a-zA-Z]/.test(rawRtf[i])) i++;
        const word = rawRtf.slice(wordStart, i);

        let param: number | null = null;
        if (i < len && (rawRtf[i] === '-' || /\d/.test(rawRtf[i]))) {
          const numStart = i;
          if (rawRtf[i] === '-') i++;
          while (i < len && /\d/.test(rawRtf[i])) i++;
          param = Number.parseInt(rawRtf.slice(numStart, i), 10);
        }
        // Single space delimiter after control word is consumed
        if (i < len && rawRtf[i] === ' ') {
          i++;
        }

        if (SKIP_DESTINATIONS.has(word)) {
          current.skip = true;
          continue;
        }

        if (word === 'uc' && param !== null) {
          current.uc = Math.max(0, param);
          continue;
        }

        if (current.skip) continue;

        if (word === 'u' && param !== null) {
          const codePoint = param < 0 ? param + 65536 : param;
          out.push(String.fromCharCode(codePoint));
          // Skip `current.uc` replacement tokens after \uN
          let toSkip = current.uc;
          while (toSkip > 0 && i < len) {
            if (rawRtf[i] === '\\' && rawRtf[i + 1] === "'" && i + 3 < len) {
              i += 4;
            } else if (rawRtf[i] === '{' || rawRtf[i] === '}') {
              break;
            } else {
              i++;
            }
            toSkip--;
          }
        } else if (word === 'par' || word === 'line') {
          out.push('\n');
        } else if (word === 'tab') {
          out.push(' ');
        } else if (word === 'emdash') {
          out.push('—');
        } else if (word === 'endash') {
          out.push('–');
        } else if (word === 'lquote' || word === 'rquote') {
          out.push("'");
        } else if (word === 'ldblquote' || word === 'rdblquote') {
          out.push('"');
        }
        continue;
      }

      // Unknown single-char control symbol
      i++;
      continue;
    }

    // Normal literal character
    flushHex();
    if (!current.skip) {
      out.push(ch);
    }
    i++;
  }

  flushHex();
  return cleanLineEndings(out.join(''));
}
