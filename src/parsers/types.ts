export interface ParsedDocument {
  title: string;
  content: string;
  format: string;
  warnings: string[];
}

export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentParseError';
  }
}
