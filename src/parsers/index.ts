import { isOle2Buffer, parseLegacyDocBuffer } from './docBinaryParser';
import { parseDocxBuffer } from './docxParser';
import { parseHtmlText, parseRtfText } from './htmlRtfParser';
import { parsePdfBuffer } from './pdfParser';
import { decodeTextBuffer, parseMarkdownText, parseSubtitleText } from './textParser';
import { DocumentParseError, type ParsedDocument } from './types';

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function isZipBuffer(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Parses any uploaded document buffer using magic-byte sniffing + extension routing.
 */
export async function parseDocumentBuffer(
  buffer: ArrayBuffer,
  filename: string,
): Promise<ParsedDocument> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    throw new DocumentParseError('The selected file is empty.');
  }

  const ext = getExtension(filename);
  const title = stripExtension(filename) || 'Imported Script';

  // 1. PDF (%PDF-)
  if (startsWithAscii(bytes, '%PDF-') || ext === 'pdf') {
    const { text, warnings } = await parsePdfBuffer(buffer);
    return { title, content: text, format: 'PDF', warnings };
  }

  // 2. DOCX (ZIP magic PK\x03\x04)
  if ((isZipBuffer(bytes) && (ext === 'docx' || ext === 'doc')) || ext === 'docx') {
    const text = await parseDocxBuffer(buffer);
    return { title, content: text, format: 'DOCX', warnings: [] };
  }

  // 3. Legacy Binary OLE2 .doc
  if (isOle2Buffer(bytes)) {
    const { text, warnings } = parseLegacyDocBuffer(buffer);
    return { title, content: text, format: 'DOC (Binary)', warnings };
  }

  // Decode text for text-based formats (and misnamed .doc files that are actually RTF/HTML!)
  const decoded = decodeTextBuffer(buffer);
  const trimmedHead = decoded.slice(0, 256).trimStart();

  // 4. RTF ({\rtf...)
  if (trimmedHead.startsWith('{\\rtf') || ext === 'rtf') {
    const content = parseRtfText(decoded);
    if (!content) {
      throw new DocumentParseError('No readable text found in RTF document.');
    }
    return { title, content, format: 'RTF', warnings: [] };
  }

  // 5. HTML
  if (
    ext === 'html' ||
    ext === 'htm' ||
    /^<!doctype html/i.test(trimmedHead) ||
    /^<html[\s>]/i.test(trimmedHead)
  ) {
    const content = parseHtmlText(decoded);
    if (!content) {
      throw new DocumentParseError('No readable text found in HTML document.');
    }
    return { title, content, format: 'HTML', warnings: [] };
  }

  // 6. Subtitles (.srt, .vtt)
  if (ext === 'srt' || ext === 'vtt' || /^WEBVTT\b/i.test(trimmedHead)) {
    const content = parseSubtitleText(decoded);
    return { title, content, format: ext.toUpperCase() || 'VTT', warnings: [] };
  }

  // 7. Markdown (.md, .markdown)
  if (ext === 'md' || ext === 'markdown') {
    const content = parseMarkdownText(decoded);
    return { title, content, format: 'Markdown', warnings: [] };
  }

  // 8. Generic text fallback (TXT, CSV, LOG, or any unknown plain-text file)
  if (!decoded.trim()) {
    throw new DocumentParseError('No readable text could be extracted from this file.');
  }

  return {
    title,
    content: decoded,
    format: ext ? ext.toUpperCase() : 'TEXT',
    warnings: [],
  };
}

export async function parseDocumentFile(file: File): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();
  return parseDocumentBuffer(buffer, file.name);
}
