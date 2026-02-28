"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPdfText = void 0;
const pdfParseModule = require('pdf-parse');
const resolvePdfParser = () => {
    if (pdfParseModule?.PDFParse) {
        return { type: 'class', parser: pdfParseModule.PDFParse };
    }
    if (typeof pdfParseModule?.default === 'function') {
        return { type: 'function', parser: pdfParseModule.default };
    }
    if (typeof pdfParseModule === 'function') {
        return { type: 'function', parser: pdfParseModule };
    }
    return null;
};
const extractPdfText = async (buffer) => {
    const resolved = resolvePdfParser();
    if (!resolved) {
        throw new Error('pdf-parse export not supported');
    }
    if (resolved.type === 'class') {
        const parser = new resolved.parser({ data: buffer });
        try {
            const result = await parser.getText();
            return result?.text || '';
        }
        finally {
            await parser.destroy().catch(() => undefined);
        }
    }
    const result = await resolved.parser(buffer);
    return result?.text || '';
};
exports.extractPdfText = extractPdfText;
//# sourceMappingURL=pdf.js.map