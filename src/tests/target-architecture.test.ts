import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = path.join(ROOT, 'src');

const DEAD_SELECTOR_EXCEPTIONS: string[] = [];
const DUPLICATE_CLASS_EXCEPTIONS: string[] = [];

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function relative(file: string): string {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function runtimeFiles(): string[] {
  return walk(SRC).filter((file) => (
    /\.(?:js|jsx|ts|tsx)$/.test(file)
    && !relative(file).startsWith('src/tests/')
  ));
}

function sourceFiles(directory: string): string[] {
  return walk(path.join(SRC, directory)).filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file));
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
}

describe('F1 target module map and deletion boundary', () => {
  it('boots the rebuilt client unconditionally from final paths', () => {
    const main = read('src/main.jsx');
    expect(fs.existsSync(path.join(SRC, 'next'))).toBe(false);
    expect(main).not.toContain('VITE_UI');
    expect(main).not.toContain('./next/');
    expect(main).not.toContain('./styles.css');
    expect(main).not.toContain('./animations/');
    expect(main).toContain("import('./App')");
    expect(main).toContain("dataset.shell = 'next'");
  });

  it('contains exactly the final component, view, hook, and style inventories', () => {
    const names = (directory: string, extension: RegExp) => fs.readdirSync(path.join(SRC, directory))
      .filter((name) => extension.test(name))
      .sort();

    expect(names('components', /\.jsx$/)).toEqual([
      'Banner.jsx',
      'Button.jsx',
      'Card.jsx',
      'CommandPalette.jsx',
      'Dropzone.jsx',
      'EmptyState.jsx',
      'ErrorState.jsx',
      'Field.jsx',
      'FileList.jsx',
      'FileRow.jsx',
      'Icon.jsx',
      'Modal.jsx',
      'ProgressBar.jsx',
      'ResumeStrip.jsx',
      'RunBar.jsx',
      'Sidebar.jsx',
      'Skeleton.jsx',
      'StatusBadge.jsx',
      'Tabs.jsx',
      'Toast.jsx',
      'Toggle.jsx',
      'Topbar.jsx',
      'index.jsx',
    ].sort());
    expect(names('views', /\.jsx$/)).toEqual([
      'Activity.jsx',
      'AssetGallery.jsx',
      'Home.jsx',
      'Profile.jsx',
      'Settings.jsx',
    ]);
    expect(names('hooks', /\.js$/)).toEqual([
      'useCapabilities.js',
      'useConvertWorkbench.js',
      'useFocusTrap.js',
      'useJobPreviewUrl.js',
      'useMediaWorkbench.js',
      'useMotionPreference.js',
      'usePdfWorkbench.js',
      'useSecurityArchiveWorkbench.js',
      'useStore.js',
      'useTextDevWorkbench.js',
      'useUtilitiesWorkbench.js',
    ].sort());
    expect(names('styles', /\.css$/)).toEqual([
      'base.css',
      'motion.css',
      'primitives.css',
      'tokens.css',
      'views.css',
      'workbench.css',
    ]);
  });

  it('removes the complete legacy target-state deletion set', () => {
    const deleted = [
      'src/animations',
      'src/data/tools.js',
      'src/lib/liveState.js',
      'src/styles.css',
      'src/hooks/useWorkspace.js',
      'src/hooks/useWorkspaceEvents.js',
      'src/hooks/useJobRunner.js',
      'src/hooks/useAnimationActivity.js',
    ];
    for (const target of deleted) expect(fs.existsSync(path.join(ROOT, target)), target).toBe(false);
  });
});

describe('F1 target dependency and transport boundaries', () => {
  it('keeps hub input acceptance free of hard-coded format and MIME literals', () => {
    const acceptanceSurface = [
      ...sourceFiles('hubs'),
      path.join(SRC, 'workbench', 'Workbench.jsx'),
    ];
    const literal = /['"`](?:\.[a-z0-9]{2,8}(?:\s*,\s*\.[a-z0-9]{2,8})*|(?:audio|image|text|video|application)\/[a-z0-9.+*-]+)['"`]/i;
    const offenders = acceptanceSurface
      .filter((file) => literal.test(fs.readFileSync(file, 'utf8')))
      .map(relative);
    expect(offenders).toEqual([]);
    for (const file of sourceFiles('hubs')) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, relative(file)).not.toMatch(/\baccept\s*:/);
    }
    expect(read('src/components/Dropzone.jsx')).not.toMatch(/\baccept\s*=\s*["']/);
  });

  it('limits browser networking to the three sanctioned modules', () => {
    const sanctioned = new Set([
      'src/api/client.js',
      'src/api/resumableUpload.js',
      'src/protocol/events.ts',
    ]);
    const networkOwners = runtimeFiles()
      .filter((file) => /(?:\bfetch|globalThis\.fetch)\s*\(|new\s+XMLHttpRequest|new\s+EventSource/.test(
        fs.readFileSync(file, 'utf8'),
      ))
      .map(relative)
      .sort();
    expect(networkOwners.filter((file) => !sanctioned.has(file))).toEqual([]);
  });

  it('keeps all event-stream ownership out of api/client.js', () => {
    const client = read('src/api/client.js');
    expect(client).not.toMatch(
      /EventSource|text\/event-stream|subscribeWorkspaceEvents|subscribeViaFetch|waitViaSse|SSE_ERROR/,
    );
  });

  it('allows only store.ts to import protocol/events.ts', () => {
    const importers = runtimeFiles().filter((file) => importSpecifiers(
      fs.readFileSync(file, 'utf8'),
    ).some((specifier) => (
      /(?:^|\/)protocol\/events(?:\.[jt]s)?$/.test(specifier)
      || specifier === './events'
      || specifier === './events.js'
    ))).map(relative);
    expect(importers).toEqual(['src/protocol/store.ts']);
  });

  it('enforces the leaf and presentation dependency rules', () => {
    for (const file of sourceFiles('components')) {
      expect(importSpecifiers(fs.readFileSync(file, 'utf8')), relative(file))
        .not.toEqual(expect.arrayContaining([
          expect.stringMatching(/(?:^|\/)(?:api|protocol)(?:\/|$)/),
        ]));
    }
    for (const file of sourceFiles('hubs')) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, relative(file)).not.toMatch(/<[A-Z][A-Za-z]*[\s/>]/);
      expect(importSpecifiers(source), relative(file)).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/react|(?:^|\/)(?:components|workbench)(?:\/|$)|protocol\/store/),
      ]));
    }
    for (const file of sourceFiles('lib')) {
      expect(importSpecifiers(fs.readFileSync(file, 'utf8')), relative(file))
        .not.toEqual(expect.arrayContaining([
          expect.stringMatching(/react|(?:^|\/)(?:api|protocol|components)(?:\/|$)/),
        ]));
    }
  });

  it('keeps server tests independent from client source', () => {
    const offenders = walk(path.join(ROOT, 'server', 'tests'))
      .filter((file) => /\.test\.ts$/.test(file))
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return /(?:\.\.\/){2}src\//.test(source)
          || /path\.join\(\s*root\s*,\s*['"]src['"]/.test(source)
          || /\bread\(\s*['"]src(?:\/|['"])/.test(source);
      })
      .map(relative);
    expect(offenders).toEqual([]);
  });
});

describe('F1 complete §7.2 structural surface', () => {
  it('has no transitional structural exception entries', () => {
    expect(DEAD_SELECTOR_EXCEPTIONS).toEqual([]);
    expect(DUPLICATE_CLASS_EXCEPTIONS).toEqual([]);
  });

  it('keeps one implementation for every exactly-one primitive', () => {
    const files = runtimeFiles();
    const sources = files.map((file) => ({ file: relative(file), source: fs.readFileSync(file, 'utf8') }));

    expect(files.filter((file) => path.basename(file) === 'useFocusTrap.js').map(relative))
      .toEqual(['src/hooks/useFocusTrap.js']);
    expect(sources.flatMap(({ source }) => source.match(/export function formatBytes\b/g) ?? []))
      .toHaveLength(1);
    expect(sources.flatMap(({ source }) => source.match(/type=["']file["']/g) ?? []))
      .toHaveLength(1);
    expect(sources.flatMap(({ source }) => source.match(/role=["']tablist["']/g) ?? []))
      .toHaveLength(1);
    expect(files.filter((file) => path.basename(file) === 'ProgressBar.jsx').map(relative))
      .toEqual(['src/components/ProgressBar.jsx']);
  });

  it('keeps the global shell a11y contract in the one final implementation', () => {
    const app = read('src/App.jsx');
    const topbar = read('src/components/Topbar.jsx');
    const modal = read('src/components/Modal.jsx');
    const tabs = read('src/components/Tabs.jsx');
    expect(topbar).toContain('Skip to content');
    expect(topbar).toContain('tabIndex={-1}');
    expect(app).toContain('role="status"');
    expect(app).toContain('aria-live="polite"');
    expect(modal).toContain('aria-modal="true"');
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain("key === 'Home'");
    expect(tabs).toContain("key === 'End'");
  });

  it('uses the asset registry and contains no emoji icon glyphs', () => {
    const offenders = runtimeFiles().filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      if (relative(file) === 'src/assets/registry.js') return false;
      return /['"`]\/assets\//.test(source) || /[\u{1F300}-\u{1FAFF}]/u.test(source);
    }).map(relative);
    expect(offenders).toEqual([]);
  });

  it('limits browser storage ownership to the §6.1 modules and key families', () => {
    const storageOwners = runtimeFiles()
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return /(?:(?:globalThis\.)?(?:localStorage|sessionStorage))\.(?:getItem|setItem|removeItem)/.test(source)
          || (relative(file) === 'src/protocol/store.ts' && /storageFor\(/.test(source));
      })
      .map(relative)
      .sort();
    expect(storageOwners).toEqual([
      'src/App.jsx',
      'src/api/resumableUpload.js',
      'src/hooks/useMotionPreference.js',
      'src/protocol/store.ts',
    ]);
    expect(read('src/protocol/store.ts')).toContain("'alphastudio-workspace-id'");
    expect(read('src/protocol/store.ts')).toContain("'alphastudio-active-job:'");
    expect(read('src/api/resumableUpload.js')).toContain("'alphastudio:upload'");
    expect(read('src/hooks/useMotionPreference.js')).toContain("'alpha-studio-motion'");
    expect(read('src/App.jsx')).toContain("'alpha-studio-theme'");
  });

  it('keeps hosted API and resumable upload behavior on the final client path', () => {
    const api = read('src/api/client.js');
    const resumable = read('src/api/resumableUpload.js');
    const uploads = read('src/protocol/uploads.ts');
    const workbench = read('src/workbench/Workbench.jsx');
    expect(api).toMatch(/VITE_API_URL\s*\|\|\s*['"]['"]/);
    expect(api).not.toMatch(/API_BASE\s*=.*127\.0\.0\.1:8787/);
    expect(api).toContain('fetchJobBlob');
    expect(api).toContain('downloadPath');
    expect(resumable).toContain('file.slice(start, endExclusive)');
    expect(resumable).not.toContain('this.file.arrayBuffer(');
    expect(resumable).toContain('Content-Range');
    expect(resumable).toContain('X-Chunk-SHA256');
    expect(uploads).toContain('recoverUploadSessions');
    expect(uploads).toContain('receivedBytes');
    expect(workbench).toContain('Pause');
    expect(workbench).toContain('ResumeStrip');
    expect(workbench).toContain('actionLabel="Retry"');
    expect(workbench).toContain('Cancel');
  });

  it('has zero dead selectors and no bare class definition split across style files', () => {
    const renderSource = runtimeFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    const dynamicPrefixes = new Set(
      [...renderSource.matchAll(/([a-zA-Z_][\w-]*-)\$\{/g)].map((match) => match[1]),
    );
    const classesByFile = new Map<string, Set<string>>();

    for (const file of walk(path.join(SRC, 'styles')).filter((item) => item.endsWith('.css'))) {
      const source = fs.readFileSync(file, 'utf8');
      const classes = new Set(
        [...source.matchAll(/\.(-?[_a-zA-Z]+[\w-]*)/g)].map((match) => match[1]),
      );
      classesByFile.set(relative(file), classes);
    }

    const allClasses = new Set([...classesByFile.values()].flatMap((classes) => [...classes]));
    const dead = [...allClasses].filter((className) => (
      !renderSource.includes(className)
      && ![...dynamicPrefixes].some((prefix) => className.startsWith(prefix))
      && !DEAD_SELECTOR_EXCEPTIONS.includes(className)
    )).sort();
    expect(dead).toEqual([]);

    const bareDefinitions = new Map<string, string[]>();
    for (const [file, classes] of classesByFile) {
      // motion.css decorates shared states; structural ownership remains with
      // the component/view stylesheet that defines the static class.
      if (file === 'src/styles/motion.css') continue;
      const css = read(file);
      for (const className of classes) {
        const bare = new RegExp(`(?:^|})\\s*\\.${className.replaceAll('-', '\\-')}\\s*\\{`, 'm');
        if (!bare.test(css)) continue;
        const owners = bareDefinitions.get(className) || [];
        owners.push(file);
        bareDefinitions.set(className, owners);
      }
    }
    const duplicates = [...bareDefinitions]
      .filter(([className, owners]) => (
        owners.length > 1 && !DUPLICATE_CLASS_EXCEPTIONS.includes(className)
      ))
      .map(([className, owners]) => `${className}: ${owners.join(', ')}`);
    expect(duplicates).toEqual([]);
  });
});
