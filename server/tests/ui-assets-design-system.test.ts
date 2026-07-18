import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const resolve = (...parts: string[]) => path.join(root, ...parts);
const read = (...parts: string[]) => fs.readFileSync(resolve(...parts), 'utf8');

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const toolIcons = [
  'converter', 'image', 'pdf', 'media', 'audio', 'archive', 'qr', 'text-ocr',
  'security', 'developer', 'color', 'activity', 'profile', 'settings', 'tools-manager',
];

const statusIcons = [
  'uploading', 'inspecting', 'queued', 'converting', 'completed', 'warning',
  'failed', 'cancelled', 'unavailable',
];

describe('AlphaStudio v3.4 custom asset system', () => {
  it('ships every required brand asset and explicit light/dark variants', () => {
    const required = [
      'alphastudio-mark.svg',
      'alphastudio-mark-dark.svg',
      'alphastudio-mark-light.svg',
      'alphastudio-wordmark.svg',
      'alphastudio-wordmark-light.svg',
      'logo-horizontal.svg',
      'logo-horizontal-light.svg',
      'logo-monochrome.svg',
      'favicon.svg',
      'app-icon-192.png',
      'app-icon-512.png',
      'app-icon-maskable-512.png',
    ];

    for (const name of required) {
      const file = resolve('public', 'assets', 'brand', name);
      assert.ok(fs.existsSync(file), `missing brand asset: ${name}`);
      assert.ok(fs.statSync(file).size > 100, `brand asset is unexpectedly empty: ${name}`);
    }
  });

  it('registers valid PNG app-icon dimensions and maskable purpose', () => {
    const dimensions = (name: string) => {
      const data = fs.readFileSync(resolve('public', 'assets', 'brand', name));
      assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG');
      return [data.readUInt32BE(16), data.readUInt32BE(20)];
    };

    assert.deepEqual(dimensions('app-icon-192.png'), [192, 192]);
    assert.deepEqual(dimensions('app-icon-512.png'), [512, 512]);
    assert.deepEqual(dimensions('app-icon-maskable-512.png'), [512, 512]);

    const manifest = JSON.parse(read('public', 'manifest.webmanifest')) as {
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
    assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  });

  it('uses a complete 24x24 SVG sprite for tool and semantic status icons', () => {
    const sprite = read('public', 'assets', 'icons', 'alphastudio-icons.svg');
    for (const name of [...toolIcons, ...statusIcons]) {
      assert.match(sprite, new RegExp(`id=["']icon-${name}["']`), `missing icon symbol: ${name}`);
    }

    const symbols = sprite.match(/<symbol\b[^>]*>/g) || [];
    assert.ok(symbols.length >= toolIcons.length + statusIcons.length);
    for (const symbol of symbols) {
      assert.match(symbol, /viewBox=["']0 0 24 24["']/);
    }
  });

  it('keeps all vector assets small and free of active/base64 content', () => {
    const svgFiles = walk(resolve('public', 'assets')).filter((file) => file.endsWith('.svg'));
    assert.ok(svgFiles.length >= 30);
    for (const file of svgFiles) {
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(fs.statSync(file).size < 20_000, `${path.basename(file)} exceeds 20 KB`);
      assert.doesNotMatch(source, /<script\b|<foreignObject\b|\bon\w+\s*=|data:/i, path.basename(file));
      assert.match(source, /<svg\b/);
    }

    const total = walk(resolve('public', 'assets'))
      .reduce((sum, file) => sum + fs.statSync(file).size, 0);
    assert.ok(total < 350_000, `asset payload is too large: ${total} bytes`);
  });

  it('ships all tool and contextual empty-state illustrations', () => {
    for (const name of [
      'converter', 'pdf', 'qr', 'image', 'media', 'archive', 'text', 'audio',
      'color', 'security', 'developer',
    ]) {
      assert.ok(fs.existsSync(resolve('public', 'assets', 'illustrations', 'tools', `${name}.svg`)));
    }

    for (const name of [
      'upload', 'converted', 'no-results', 'tools-missing', 'conversion-failed', 'offline',
    ]) {
      const source = read('public', 'assets', 'illustrations', 'empty', `${name}.svg`);
      assert.match(source, /viewBox=["']0 0 480 300["']/);
      assert.match(source, /<title\b/);
      assert.match(source, /<desc\b/);
    }
  });

  it('renders icons through one accessible registry without raw SVG injection', () => {
    const icon = read('src', 'components', 'Icon.jsx');
    const registry = read('src', 'assets', 'registry.js');
    assert.match(icon, /<use href=/);
    assert.match(icon, /aria-hidden/);
    assert.match(icon, /aria-labelledby/);
    assert.doesNotMatch(icon, /dangerouslySetInnerHTML/);

    for (const name of [...toolIcons, ...statusIcons]) {
      assert.match(registry, new RegExp(`["']${name}["']`));
    }
    assert.match(registry, /toolIllustrations/);
    assert.match(registry, /emptyIllustrations/);
    assert.match(registry, /patternAssets/);
  });

  it('integrates real assets into navigation, jobs, workspaces, and empty states', () => {
    const sidebar = read('src', 'components', 'Sidebar.jsx');
    const dashboard = read('src', 'views', 'DashboardView.jsx');
    const converter = read('src', 'views', 'ConverterView.jsx');
    const modular = read('src', 'views', 'ModularWorkspaceView.jsx');
    const outputs = read('src', 'components', 'JobOutputCard.jsx');
    const picker = read('src', 'components', 'FilePicker.jsx');
    const tools = read('src', 'data', 'tools.js');

    assert.match(sidebar, /BrandMark/);
    assert.match(tools, /toolIllustrations/);
    assert.match(dashboard, /type="offline"/);
    assert.match(dashboard, /type="noResults"/);
    assert.match(converter, /type=\{resultRows\.length \? 'noResults' : 'converted'\}/);
    assert.match(modular, /type="toolsMissing"/);
    assert.match(outputs, /type="conversionFailed"/);
    assert.match(picker, /emptyIllustrations\.upload/);
    assert.match(`${dashboard}\n${converter}\n${outputs}`, /status=\{(?:job|row)\.status\}/);
  });

  it('gates the responsive asset gallery to development builds', () => {
    const app = read('src', 'App.jsx');
    const gallery = read('src', 'views', 'AssetGalleryView.jsx');
    const styles = read('src', 'styles.css');

    assert.match(app, /import\.meta\.env\.DEV\s*\?\s*React\.lazy/);
    assert.match(app, /import\.meta\.env\.DEV\s*\?\s*\{ assets: AssetGalleryView \}/);
    assert.match(gallery, /if \(!import\.meta\.env\.DEV\) return null/);
    assert.match(gallery, /toolIconNames/);
    assert.match(gallery, /statusIconNames/);
    assert.match(gallery, /appIconMaskable/);
    assert.match(styles, /@media \(max-width: 920px\)/);
    assert.match(styles, /@media \(max-width: 640px\)/);
    assert.match(styles, /asset-illustration-grid/);
    assert.match(styles, /alpha-empty-state\.is-compact/);
  });

  it('links the favicon, manifest, docs, and release version', () => {
    const index = read('index.html');
    const rootPackage = JSON.parse(read('package.json')) as { version: string };
    const serverPackage = JSON.parse(read('server', 'package.json')) as { version: string };
    assert.match(index, /assets\/brand\/favicon\.svg/);
    assert.match(index, /manifest\.webmanifest/);
    assert.ok(fs.existsSync(resolve('docs', 'assets.md')));
    assert.equal(rootPackage.version, '3.6.0');
    assert.equal(serverPackage.version, '3.6.0');
  });
});
