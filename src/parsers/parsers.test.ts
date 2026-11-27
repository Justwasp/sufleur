import { describe, expect, it } from 'vitest';
import { parseDocumentBuffer } from './index';
import { parseLegacyDocBuffer } from './docBinaryParser';
import { parseHtmlText, parseRtfText } from './htmlRtfParser';
import { parseMarkdownText, parseSubtitleText } from './textParser';

/**
 * Builds a minimal, spec-compliant binary OLE2 CFBF + Word 97-2003 (.doc) file in memory
 * containing a real FIB, 1Table stream with Pcdt PlcPcd piece table, and UTF-16LE Unicode text.
 */
function buildSyntheticBinaryDoc(text: string): ArrayBuffer {
  const sectorSize = 512;

  // Prepare UTF-16LE text inside WordDocument stream at offset 0x200
  const textBytes = new Uint8Array(text.length * 2);
  const tView = new DataView(textBytes.buffer);
  for (let i = 0; i < text.length; i++) {
    tView.setUint16(i * 2, text.charCodeAt(i), true);
  }

  // Build 1Table stream with Pcdt (0x02) + lcbPcdt (16 bytes: 2 CPs + 1 PCD)
  const tableSize = 512;
  const tableStream = new Uint8Array(tableSize);
  const tblView = new DataView(tableStream.buffer);
  tableStream[0] = 0x02; // Pcdt
  tblView.setUint32(1, 16, true); // lcbPcdt = 4*(1+1) + 8*1 = 16
  tblView.setUint32(5, 0, true); // CP[0] = 0
  tblView.setUint32(9, text.length, true); // CP[1] = text.length
  // PCD[0] at offset 13 (8 bytes): fc at +2 = 0x200 (uncompressed UTF-16LE)
  tblView.setUint32(13 + 2, 0x200, true);

  // Build WordDocument stream (4096+ bytes so it's stored in regular FAT, not mini-stream)
  const wordDocSize = 4096;
  const wordDoc = new Uint8Array(wordDocSize);
  const wView = new DataView(wordDoc.buffer);
  wView.setUint16(0x0000, 0xa5ec, true); // wIdent
  wView.setUint16(0x000a, 0x0200, true); // flags: fWhichTblStm = 1Table
  wView.setUint32(0x004c, text.length, true); // ccpText
  wView.setUint32(0x01a2, 0, true); // fcClx
  wView.setUint32(0x01a6, 21, true); // lcbClx = 1 + 4 + 16
  wordDoc.set(textBytes, 0x200);

  // Also make 1Table >= 4096 bytes so it uses regular FAT sectors
  const paddedTable = new Uint8Array(4096);
  paddedTable.set(tableStream, 0);

  // Sectors layout:
  // Sector 0: FAT
  // Sector 1: Directory
  // Sectors 2..9 (8 sectors): WordDocument (4096 bytes)
  // Sectors 10..17 (8 sectors): 1Table (4096 bytes)
  const totalSectors = 18;
  const file = new Uint8Array((1 + totalSectors) * sectorSize);
  const fView = new DataView(file.buffer);

  // OLE2 Header
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  file.set(magic, 0);
  fView.setUint16(24, 0x003e, true);
  fView.setUint16(26, 0x0003, true);
  fView.setUint16(28, 0xfffe, true);
  fView.setUint16(30, 9, true); // 512-byte sectors
  fView.setUint16(32, 6, true); // 64-byte mini-sectors
  fView.setUint32(44, 1, true); // numFatSectors
  fView.setUint32(48, 1, true); // firstDirSector = 1
  fView.setUint32(56, 4096, true); // miniStreamCutoff
  fView.setUint32(60, 0xfffffffe, true); // no MiniFAT
  fView.setUint32(68, 0xfffffffe, true); // no extra DIFAT
  fView.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) {
    fView.setUint32(76 + i * 4, i === 0 ? 0 : 0xffffffff, true);
  }

  // Sector 0: FAT
  const fatOff = 1 * sectorSize;
  fView.setUint32(fatOff + 0 * 4, 0xfffffffd, true); // FAT sector
  fView.setUint32(fatOff + 1 * 4, 0xfffffffe, true); // Directory sector
  for (let s = 2; s <= 8; s++) fView.setUint32(fatOff + s * 4, s + 1, true);
  fView.setUint32(fatOff + 9 * 4, 0xfffffffe, true);
  for (let s = 10; s <= 16; s++) fView.setUint32(fatOff + s * 4, s + 1, true);
  fView.setUint32(fatOff + 17 * 4, 0xfffffffe, true);

  // Sector 1: Directory entries (Root Entry, WordDocument, 1Table)
  const dirOff = 2 * sectorSize;
  const writeDirEntry = (idx: number, name: string, type: number, startSec: number, size: number) => {
    const base = dirOff + idx * 128;
    for (let i = 0; i < name.length; i++) {
      fView.setUint16(base + i * 2, name.charCodeAt(i), true);
    }
    fView.setUint16(base + name.length * 2, 0, true);
    fView.setUint16(base + 64, (name.length + 1) * 2, true);
    file[base + 66] = type;
    fView.setUint32(base + 116, startSec, true);
    fView.setUint32(base + 120, size, true);
  };
  writeDirEntry(0, 'Root Entry', 5, 0xfffffffe, 0);
  writeDirEntry(1, 'WordDocument', 2, 2, wordDocSize);
  writeDirEntry(2, '1Table', 2, 10, 4096);

  // Copy streams
  file.set(wordDoc, (1 + 2) * sectorSize);
  file.set(paddedTable, (1 + 10) * sectorSize);

  return file.buffer;
}

describe('Document parsers', () => {
  it('parses plain UTF-8 TXT and Markdown cleanly', async () => {
    const md = '# Opening Keynote\n\nWelcome to **Sufleur** — visit [our site](https://example.com) today!';
    expect(parseMarkdownText(md)).toBe('Opening Keynote\n\nWelcome to Sufleur — visit our site today!');

    const buf = new TextEncoder().encode(md).buffer;
    const parsed = await parseDocumentBuffer(buf, 'keynote.md');
    expect(parsed.format).toBe('Markdown');
    expect(parsed.title).toBe('keynote');
    expect(parsed.content).toContain('Welcome to Sufleur');
  });

  it('parses SRT and VTT subtitles by stripping timestamps and cue tags', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
<i>Hello studio audience!</i>

2
00:00:04,000 --> 00:00:07,000
Let's begin the broadcast.`;

    expect(parseSubtitleText(srt)).toBe("Hello studio audience!\n\nLet's begin the broadcast.");
  });

  it('parses HTML stripping scripts/styles and preserving paragraphs', () => {
    const html = `<!doctype html><html><head><style>body{color:red}</style></head>
      <body><script>alert(1)</script><h1>Headline</h1><p>First line.</p><p>Second line.</p></body></html>`;
    const out = parseHtmlText(html);
    expect(out).not.toContain('alert');
    expect(out).toContain('Headline');
    expect(out).toContain('First line.');
    expect(out).toContain('Second line.');
  });

  it('parses RTF with font tables, Unicode \\uN escapes, and misnamed .doc extension', async () => {
    const rtf =
      '{\\rtf1\\ansi\\ansicpg1251{\\fonttbl{\\f0 Arial;}}Hello teleprompter!\\par \\u1055?\\u1088?\\u1080?\\u1074?\\u1077?\\u1090?!}';
    expect(parseRtfText(rtf)).toBe('Hello teleprompter!\nПривет!');

    // Misnamed RTF saved with .doc extension
    const buf = new TextEncoder().encode(rtf).buffer;
    const parsed = await parseDocumentBuffer(buf, 'speech.doc');
    expect(parsed.format).toBe('RTF');
    expect(parsed.content).toBe('Hello teleprompter!\nПривет!');
  });

  it('parses genuine binary OLE2 Word 97-2003 (.doc) with UTF-16LE English and Cyrillic text', async () => {
    const sample = 'Hello from legacy binary Word.\rПривет из старого DOC!';
    const docBuffer = buildSyntheticBinaryDoc(sample);

    const direct = parseLegacyDocBuffer(docBuffer);
    expect(direct.text).toBe('Hello from legacy binary Word.\nПривет из старого DOC!');

    const routed = await parseDocumentBuffer(docBuffer, 'legacy-script.doc');
    expect(routed.format).toBe('DOC (Binary)');
    expect(routed.content).toBe('Hello from legacy binary Word.\nПривет из старого DOC!');
  });
});
