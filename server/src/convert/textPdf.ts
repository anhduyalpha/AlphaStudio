import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { randomServerName } from '../lib/paths.js';

const UNICODE_FONT_CANDIDATES = [
  process.env.PDF_FONT_PATH,
  process.platform === 'win32' ? 'C:\\Windows\\Fonts\\arial.ttf' : '',
  process.platform === 'win32' ? 'C:\\Windows\\Fonts\\segoeui.ttf' : '',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
].filter(Boolean) as string[];

export function resolvePdfFontPath(): string | null {
  return UNICODE_FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

/** Simple text/markdown/html-ish → PDF without external tools */
export async function textToPdf(opts: {
  inputPath?: string;
  text?: string;
  outputDir: string;
  title?: string;
}): Promise<{ outputPath: string; outputName: string }> {
  const text =
    opts.text ??
    (opts.inputPath ? fs.readFileSync(opts.inputPath, 'utf8') : '');
  const doc = await PDFDocument.create();
  const fontPath = resolvePdfFontPath();
  let renderText = text.replace(/\r\n/g, '\n');
  let font;
  if (fontPath) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(fs.readFileSync(fontPath), { subset: true });
  } else {
    // Last-resort compatibility for minimal containers with no Unicode font.
    // It avoids a failed job, while docs recommend installing DejaVu/Noto.
    font = await doc.embedFont(StandardFonts.Helvetica);
    renderText = renderText
      .replace(/Đ/g, 'D')
      .replace(/đ/g, 'd')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\x20-\x7e\n]/g, '?');
  }
  const fontSize = 11;
  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.35;

  const lines = wrapText(renderText, font, fontSize, maxWidth);
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const line of lines) {
    if (y < margin + lineHeight) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line.slice(0, 200), {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.12),
      maxWidth,
    });
    y -= lineHeight;
  }

  const bytes = await doc.save();
  const name = randomServerName('.pdf');
  const outputPath = path.join(opts.outputDir, name);
  fs.writeFileSync(outputPath, bytes);
  return { outputPath, outputName: `${opts.title || 'document'}.pdf` };
}

function wrapText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  fontSize: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      out.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, fontSize) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
  }
  return out.slice(0, 5000);
}

export function convertTextFormat(input: string, from: string, to: string): string {
  if (to === 'txt') {
    if (from === 'html' || from === 'htm') {
      return input.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (from === 'md') {
      return input.replace(/^#+\s+/gm, '').replace(/[*_`]/g, '');
    }
    return input;
  }
  if (to === 'md') {
    if (from === 'html') {
      return input
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n')
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n')
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    }
    return input;
  }
  if (to === 'html') {
    const escaped = input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (from === 'md') {
      const body = escaped
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br/>');
      return `<!DOCTYPE html><html><body><p>${body}</p></body></html>`;
    }
    return `<!DOCTYPE html><html><body><pre>${escaped}</pre></body></html>`;
  }
  return input;
}
