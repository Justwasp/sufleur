import { cleanLineEndings } from './textParser';
import { DocumentParseError } from './types';

let workerConfigured = false;

async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist');
  if (!workerConfigured && typeof window !== 'undefined') {
    const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    if (workerMod.default) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
    }
    workerConfigured = true;
  }
  return pdfjsLib;
}

interface PositionedItem {
  str: string;
  x: number;
  y: number;
  height: number;
  hasEOL: boolean;
}

/**
 * Extracts reading-order paragraphs from a PDF ArrayBuffer using pdfjs-dist (lazy-loaded).
 */
export async function parsePdfBuffer(
  buffer: ArrayBuffer,
): Promise<{ text: string; warnings: string[] }> {
  try {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const items: PositionedItem[] = [];
      for (const rawItem of textContent.items) {
        if (!('str' in rawItem) || !rawItem.str) continue;
        const transform = rawItem.transform as number[];
        items.push({
          str: rawItem.str,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          height: Math.abs(rawItem.height || transform[3] || 12),
          hasEOL: Boolean(rawItem.hasEOL),
        });
      }

      if (items.length === 0) continue;

      // Group items into lines by vertical Y proximity, preserving natural reading order
      const pageLines: string[] = [];
      let currentLine = '';
      let prevY = items[0].y;
      let prevHeight = items[0].height;

      for (const item of items) {
        const yDiff = Math.abs(item.y - prevY);
        const lineBreakThreshold = Math.max(4, prevHeight * 0.6);
        const paragraphThreshold = Math.max(14, prevHeight * 1.65);

        if (yDiff > lineBreakThreshold && currentLine.trim()) {
          pageLines.push(currentLine.trim());
          if (yDiff > paragraphThreshold) {
            pageLines.push('');
          }
          currentLine = item.str;
        } else {
          const needsSpace =
            currentLine.length > 0 &&
            !currentLine.endsWith(' ') &&
            !item.str.startsWith(' ');
          currentLine += (needsSpace ? ' ' : '') + item.str;
        }

        if (item.hasEOL && currentLine.trim()) {
          pageLines.push(currentLine.trim());
          currentLine = '';
        }

        prevY = item.y;
        prevHeight = item.height;
      }

      if (currentLine.trim()) {
        pageLines.push(currentLine.trim());
      }

      pages.push(pageLines.join('\n'));
    }

    const fullText = cleanLineEndings(pages.join('\n\n'));
    const warnings: string[] = [];
    if (!fullText) {
      throw new DocumentParseError(
        'No text layer found in this PDF. Scanned image-only PDFs require OCR before importing.',
      );
    }

    return { text: fullText, warnings };
  } catch (err) {
    if (err instanceof DocumentParseError) throw err;
    throw new DocumentParseError(
      `Failed to read PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
