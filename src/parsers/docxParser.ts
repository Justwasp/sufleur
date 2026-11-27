import mammoth from 'mammoth';
import { cleanLineEndings } from './textParser';
import { DocumentParseError } from './types';

/**
 * Extracts clean paragraph text from a .docx Office Open XML archive using mammoth.
 */
export async function parseDocxBuffer(buffer: ArrayBuffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = cleanLineEndings(result.value ?? '');
    if (!text) {
      throw new DocumentParseError(
        'The .docx document appears to contain no readable text.',
      );
    }
    return text;
  } catch (err) {
    if (err instanceof DocumentParseError) throw err;
    throw new DocumentParseError(
      `Could not parse .docx file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
