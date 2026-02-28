const pdfParseModule = require('pdf-parse');

type PdfParseClass = new (options: { data: Buffer }) => {
  getText: () => Promise<{ text?: string }>;
  destroy: () => Promise<void>;
};

type PdfParseFunction = (buffer: Buffer) => Promise<{ text?: string }>;

const resolvePdfParser = () => {
  if (pdfParseModule?.PDFParse) {
    return { type: 'class' as const, parser: pdfParseModule.PDFParse as PdfParseClass };
  }
  if (typeof pdfParseModule?.default === 'function') {
    return { type: 'function' as const, parser: pdfParseModule.default as PdfParseFunction };
  }
  if (typeof pdfParseModule === 'function') {
    return { type: 'function' as const, parser: pdfParseModule as PdfParseFunction };
  }
  return null;
};

export const extractPdfText = async (buffer: Buffer): Promise<string> => {
  const resolved = resolvePdfParser();
  if (!resolved) {
    throw new Error('pdf-parse export not supported');
  }

  if (resolved.type === 'class') {
    const parser = new resolved.parser({ data: buffer });
    try {
      const result = await parser.getText();
      return result?.text || '';
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  const result = await resolved.parser(buffer);
  return result?.text || '';
};
