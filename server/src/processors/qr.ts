import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import sharp from 'sharp';
import jsQRModule from 'jsqr';
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: string },
) => { data: string; version: number; location: unknown } | null;
const jsQR: JsQrFn =
  typeof jsQRModule === 'function'
    ? (jsQRModule as unknown as JsQrFn)
    : ((jsQRModule as unknown as { default: JsQrFn }).default);
import { badRequest } from '../lib/errors.js';
import { randomServerName } from '../lib/paths.js';
import type { ProcessContext, ProcessResult } from './types.js';

const MAX_CONTENT_LEN = 2953; // QR version 40 L approx
const MAX_DECODE_SIDE = 2048;
const MAX_DECODE_PIXELS = 2048 * 2048;
const ALLOWED_ECC = new Set(['L', 'M', 'Q', 'H']);

export async function processQr(ctx: ProcessContext): Promise<ProcessResult> {
  const op = String(ctx.options.operation || 'generate');
  ctx.onProgress(20, 'QR processing');

  if (op === 'generate') {
    const content = String(ctx.options.content || ctx.options.text || '');
    if (!content) throw badRequest('QR content required');
    if (content.length > MAX_CONTENT_LEN) {
      throw badRequest(`QR content too long (max ${MAX_CONTENT_LEN} characters)`);
    }
    const format = String(ctx.options.format || 'png').toLowerCase();
    if (format !== 'png' && format !== 'svg') {
      throw badRequest(`Unsupported QR format: ${format} (use png or svg)`);
    }
    const sizeRaw = Number(ctx.options.size ?? 512);
    if (!Number.isFinite(sizeRaw)) throw badRequest('size must be a number');
    const size = Math.min(Math.max(sizeRaw, 64), 2048);
    const marginRaw = Number(ctx.options.margin ?? 2);
    if (!Number.isFinite(marginRaw)) throw badRequest('margin must be a number');
    const margin = Math.min(Math.max(marginRaw, 0), 16);
    const dark = String(ctx.options.dark || '#000000');
    const light = String(ctx.options.light || '#ffffff');
    const eccRaw = String(ctx.options.ecc || 'M').toUpperCase();
    const ecc = (ALLOWED_ECC.has(eccRaw) ? eccRaw : 'M') as QRCode.QRCodeErrorCorrectionLevel;

    if (format === 'svg') {
      const svg = await QRCode.toString(content, {
        type: 'svg',
        width: size,
        margin,
        color: { dark, light },
        errorCorrectionLevel: ecc,
      });
      const name = randomServerName('.svg');
      const outputPath = path.join(ctx.outputDir, name);
      fs.writeFileSync(outputPath, svg, 'utf8');
      ctx.onProgress(100, 'QR SVG ready');
      return {
        outputPath,
        outputName: 'qrcode.svg',
        outputMime: 'image/svg+xml',
        meta: { contentLength: content.length, size, format: 'svg', margin, ecc },
      };
    }

    const name = randomServerName('.png');
    const outputPath = path.join(ctx.outputDir, name);
    await QRCode.toFile(outputPath, content, {
      type: 'png',
      width: size,
      margin,
      color: { dark, light },
      errorCorrectionLevel: ecc,
    });

    // Optional logo overlay (center), keeps QR scannable when ECC is Q/H
    const logoPath = ctx.inputPaths[0];
    if (logoPath && fs.existsSync(logoPath) && ctx.options.logo !== false) {
      try {
        const logoSize = Math.round(size * 0.18);
        const logo = await sharp(logoPath)
          .resize(logoSize, logoSize, { fit: 'cover' })
          .png()
          .toBuffer();
        const pad = Math.round(logoSize * 0.12);
        const badge = await sharp({
          create: {
            width: logoSize + pad * 2,
            height: logoSize + pad * 2,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        })
          .composite([{ input: logo, left: pad, top: pad }])
          .png()
          .toBuffer();
        const compositedPath = path.join(ctx.workDir, randomServerName('.png'));
        await sharp(outputPath)
          .composite([{ input: badge, gravity: 'centre' }])
          .png()
          .toFile(compositedPath);
        // copyFile overwrites on Windows and Linux; rename-over-existing does not.
        fs.copyFileSync(compositedPath, outputPath);
        fs.rmSync(compositedPath, { force: true });
      } catch {
        /* logo optional — keep plain QR */
      }
    }

    ctx.onProgress(100, 'QR PNG ready');
    return {
      outputPath,
      outputName: 'qrcode.png',
      outputMime: 'image/png',
      meta: { contentLength: content.length, size, format: 'png', margin, ecc },
    };
  }

  if (op === 'decode') {
    if (!ctx.inputPaths[0]) throw badRequest('Image required for QR decode');
    // Limit pixels / dimensions before raw RGBA to avoid memory DoS
    const { data, info } = await sharp(ctx.inputPaths[0], {
      limitInputPixels: MAX_DECODE_PIXELS,
      failOn: 'error',
    })
      .resize({
        width: MAX_DECODE_SIDE,
        height: MAX_DECODE_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
      inversionAttempts: 'attemptBoth',
    });
    if (!code) throw badRequest('No QR code found in image');
    const result = { text: code.data, version: code.version, location: code.location };
    const name = randomServerName('.json');
    const outputPath = path.join(ctx.outputDir, name);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
    ctx.onProgress(100, 'QR decoded');
    return {
      outputPath,
      outputName: 'qr-decode.json',
      outputMime: 'application/json',
      meta: result,
    };
  }

  throw badRequest(`Unknown QR operation: ${op}`);
}
