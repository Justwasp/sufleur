import { cleanLineEndings } from './textParser';
import { DocumentParseError } from './types';

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

interface CfbfDirectoryEntry {
  name: string;
  type: number;
  startSector: number;
  size: number;
}

export function isOle2Buffer(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  for (let i = 0; i < OLE2_MAGIC.length; i++) {
    if (bytes[i] !== OLE2_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Minimal pure-TS OLE2 Compound File Binary Format (CFBF) reader + Word 97-2003 FIB/PieceTable parser.
 * Supports both UTF-16LE Unicode pieces (English + Cyrillic) and compressed 8-bit pieces.
 */
export function parseLegacyDocBuffer(buffer: ArrayBuffer): {
  text: string;
  warnings: string[];
} {
  const bytes = new Uint8Array(buffer);
  if (!isOle2Buffer(bytes)) {
    throw new DocumentParseError('Not a valid binary OLE2 .doc file.');
  }

  const view = new DataView(buffer);
  const sectorShift = view.getUint16(30, true);
  const miniSectorShift = view.getUint16(32, true);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;

  const firstDirSector = view.getUint32(48, true);
  const miniStreamCutoff = view.getUint32(56, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const firstDifatSector = view.getUint32(68, true);
  const numDifatSectors = view.getUint32(72, true);

  const sectorOffset = (sec: number) => (sec + 1) * sectorSize;

  // 1. Collect FAT sector indices from header DIFAT (109 entries) + DIFAT chain
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = view.getUint32(76 + i * 4, true);
    if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
  }
  let difatSec = firstDifatSector;
  for (let d = 0; d < numDifatSectors && difatSec !== ENDOFCHAIN && difatSec !== FREESECT; d++) {
    const off = sectorOffset(difatSec);
    if (off + sectorSize > bytes.length) break;
    const entriesPerSector = sectorSize / 4 - 1;
    for (let i = 0; i < entriesPerSector; i++) {
      const s = view.getUint32(off + i * 4, true);
      if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
    }
    difatSec = view.getUint32(off + entriesPerSector * 4, true);
  }

  // 2. Build FAT array
  const fat: number[] = [];
  for (const s of fatSectors) {
    const off = sectorOffset(s);
    if (off + sectorSize > bytes.length) continue;
    for (let i = 0; i < sectorSize; i += 4) {
      fat.push(view.getUint32(off + i, true));
    }
  }

  const readRegularStream = (startSec: number, expectedSize?: number): Uint8Array => {
    const chunks: Uint8Array[] = [];
    let sec = startSec;
    const visited = new Set<number>();
    while (sec !== ENDOFCHAIN && sec !== FREESECT && !visited.has(sec)) {
      visited.add(sec);
      const off = sectorOffset(sec);
      if (off < 0 || off >= bytes.length) break;
      const end = Math.min(bytes.length, off + sectorSize);
      chunks.push(bytes.subarray(off, end));
      sec = sec < fat.length ? fat[sec] : ENDOFCHAIN;
    }
    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(expectedSize !== undefined ? Math.min(expectedSize, totalLen) : totalLen);
    let pos = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, out.length - pos);
      if (take <= 0) break;
      out.set(c.subarray(0, take), pos);
      pos += take;
    }
    return out;
  };

  // 3. Parse Directory Entries
  const dirBytes = readRegularStream(firstDirSector);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entries: CfbfDirectoryEntry[] = [];
  const utf16Decoder = new TextDecoder('utf-16le');

  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = dirView.getUint16(off + 64, true);
    const type = dirBytes[off + 66];
    if (type === 0 || nameLen < 2 || nameLen > 64) continue;
    const rawName = utf16Decoder.decode(dirBytes.subarray(off, off + nameLen - 2));
    const startSector = dirView.getUint32(off + 116, true);
    const size = dirView.getUint32(off + 120, true);
    entries.push({ name: rawName, type, startSector, size });
  }

  const rootEntry = entries.find((e) => e.type === 5);
  const miniStream = rootEntry ? readRegularStream(rootEntry.startSector, rootEntry.size) : new Uint8Array(0);
  const miniFatBytes =
    firstMiniFatSector !== ENDOFCHAIN && firstMiniFatSector !== FREESECT
      ? readRegularStream(firstMiniFatSector)
      : new Uint8Array(0);
  const miniFat: number[] = [];
  const mfView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) {
    miniFat.push(mfView.getUint32(i, true));
  }

  const readEntryStream = (entry: CfbfDirectoryEntry): Uint8Array => {
    if (entry.size < miniStreamCutoff && miniStream.length > 0) {
      const out = new Uint8Array(entry.size);
      let pos = 0;
      let sec = entry.startSector;
      const visited = new Set<number>();
      while (sec !== ENDOFCHAIN && sec !== FREESECT && pos < entry.size && !visited.has(sec)) {
        visited.add(sec);
        const off = sec * miniSectorSize;
        if (off >= miniStream.length) break;
        const take = Math.min(miniSectorSize, miniStream.length - off, entry.size - pos);
        out.set(miniStream.subarray(off, off + take), pos);
        pos += take;
        sec = sec < miniFat.length ? miniFat[sec] : ENDOFCHAIN;
      }
      return out;
    }
    return readRegularStream(entry.startSector, entry.size);
  };

  const wordDocEntry = entries.find((e) => e.name === 'WordDocument');
  if (!wordDocEntry) {
    throw new DocumentParseError('Binary file is an OLE2 container but not a Word .doc document.');
  }

  const wordDoc = readEntryStream(wordDocEntry);
  if (wordDoc.length < 0x1aa) {
    throw new DocumentParseError('WordDocument stream is truncated or invalid.');
  }

  const wView = new DataView(wordDoc.buffer, wordDoc.byteOffset, wordDoc.byteLength);
  const wIdent = wView.getUint16(0, true);
  if (wIdent !== 0xa5ec) {
    throw new DocumentParseError('Unsupported legacy Word binary signature.');
  }

  const flags = wView.getUint16(0x000a, true);
  const isEncrypted = Boolean(flags & 0x0100);
  if (isEncrypted) {
    throw new DocumentParseError('This .doc file is password-protected / encrypted.');
  }

  const tableName = flags & 0x0200 ? '1Table' : '0Table';
  const ccpText = wView.getUint32(0x004c, true);
  const fcClx = wView.getUint32(0x01a2, true);
  const lcbClx = wView.getUint32(0x01a6, true);

  const tableEntry = entries.find((e) => e.name === tableName);
  const warnings: string[] = [];

  if (tableEntry && lcbClx > 0) {
    const tableStream = readEntryStream(tableEntry);
    const extracted = extractViaPieceTable(wordDoc, tableStream, fcClx, lcbClx, ccpText);
    if (extracted) {
      return { text: cleanWordControlChars(extracted), warnings };
    }
  }

  // Graceful fallback: scan WordDocument stream for readable text runs
  warnings.push('Used fallback text extraction for this legacy .doc file.');
  const fallback = extractReadableFallback(wordDoc);
  if (!fallback) {
    throw new DocumentParseError('Could not extract readable text from this legacy .doc file.');
  }
  return { text: fallback, warnings };
}

function extractViaPieceTable(
  wordDoc: Uint8Array,
  tableStream: Uint8Array,
  fcClx: number,
  lcbClx: number,
  ccpText: number,
): string | null {
  if (fcClx + lcbClx > tableStream.length) return null;

  const tView = new DataView(tableStream.buffer, tableStream.byteOffset, tableStream.byteLength);
  let pos = fcClx;
  const end = fcClx + lcbClx;

  // Skip Prc records (type 0x01) until Pcdt (type 0x02)
  while (pos < end) {
    const clxt = tableStream[pos];
    if (clxt === 0x01) {
      if (pos + 3 > end) return null;
      const cbGrpprl = tView.getInt16(pos + 1, true);
      pos += 3 + Math.max(0, cbGrpprl);
    } else if (clxt === 0x02) {
      pos += 1;
      break;
    } else {
      return null;
    }
  }

  if (pos + 4 > end) return null;
  const lcbPcdt = tView.getUint32(pos, true);
  pos += 4;
  if (pos + lcbPcdt > end || lcbPcdt < 12) return null;

  // PlcPcd has (n + 1) uint32 CPs followed by n 8-byte PCD structures -> 4*(n+1) + 8*n = lcbPcdt
  const n = Math.floor((lcbPcdt - 4) / 12);
  if (n <= 0) return null;

  const cps: number[] = [];
  for (let i = 0; i <= n; i++) {
    cps.push(tView.getUint32(pos + i * 4, true));
  }

  const pcdBase = pos + (n + 1) * 4;
  const utf16Decoder = new TextDecoder('utf-16le');
  const cp1252Decoder = new TextDecoder('windows-1252');
  const pieces: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < n; i++) {
    const cpStart = cps[i];
    const cpEnd = cps[i + 1];
    if (cpEnd <= cpStart) continue;
    if (ccpText > 0 && cpStart >= ccpText) break;

    const effectiveEnd = ccpText > 0 ? Math.min(cpEnd, ccpText) : cpEnd;
    const charCount = effectiveEnd - cpStart;
    if (charCount <= 0) continue;

    const fcRaw = tView.getUint32(pcdBase + i * 8 + 2, true);
    const isCompressed = Boolean(fcRaw & 0x40000000);
    const fcValue = fcRaw & 0x3fffffff;

    if (isCompressed) {
      const byteStart = fcValue >>> 1;
      const byteEnd = Math.min(wordDoc.length, byteStart + charCount);
      if (byteStart < wordDoc.length) {
        pieces.push(cp1252Decoder.decode(wordDoc.subarray(byteStart, byteEnd)));
      }
    } else {
      const byteStart = fcValue;
      const byteEnd = Math.min(wordDoc.length, byteStart + charCount * 2);
      if (byteStart < wordDoc.length) {
        pieces.push(utf16Decoder.decode(wordDoc.subarray(byteStart, byteEnd)));
      }
    }

    totalChars += charCount;
    if (ccpText > 0 && totalChars >= ccpText) break;
  }

  return pieces.length > 0 ? pieces.join('') : null;
}

function cleanWordControlChars(raw: string): string {
  // Strip Word field codes (\x13 instruction \x14 visible \x15)
  let out = '';
  let fieldDepth = 0;
  let inFieldCode = false;

  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0x13) {
      fieldDepth++;
      inFieldCode = true;
      continue;
    }
    if (code === 0x14) {
      inFieldCode = false;
      continue;
    }
    if (code === 0x15) {
      fieldDepth = Math.max(0, fieldDepth - 1);
      if (fieldDepth === 0) inFieldCode = false;
      continue;
    }
    if (inFieldCode) continue;

    if (code === 0x0d || code === 0x0b || code === 0x0c) {
      out += '\n';
    } else if (code === 0x07) {
      out += ' ';
    } else if (code === 0x09) {
      out += ' ';
    } else if (code >= 0x20 || code === 0x0a) {
      out += raw[i];
    }
  }

  return cleanLineEndings(out);
}

function extractReadableFallback(wordDoc: Uint8Array): string {
  // Scan ASCII/UTF-8 readable chunks after FIB (0x200+)
  const slice = wordDoc.subarray(Math.min(0x200, wordDoc.length));
  const decoded = new TextDecoder('windows-1252').decode(slice);
  const runs = decoded.match(/[A-Za-z0-9.,!?;:'"()\-–— \r\n]{16,}/g) ?? [];
  return cleanLineEndings(runs.join('\n'));
}
