/**
 * archiver@8 ships ESM named exports (ZipArchive, …).
 * @types/archiver@6 still describe the v7 default factory API.
 */
declare module 'archiver' {
  import type { Transform } from 'node:stream';

  export interface ArchiverOptions {
    zlib?: { level?: number };
    store?: boolean;
    forceLocalTime?: boolean;
    forceZip64?: boolean;
    statConcurrency?: number;
  }

  export class Archiver extends Transform {
    constructor(options?: ArchiverOptions);
    append(
      source: NodeJS.ReadableStream | Buffer | string,
      data?: { name?: string; prefix?: string; date?: Date; mode?: number; stats?: unknown },
    ): this;
    file(filepath: string, data: { name?: string; prefix?: string; date?: Date; mode?: number }): this;
    directory(dirpath: string, destpath: false | string, data?: unknown): this;
    finalize(): Promise<void>;
    pointer(): number;
    abort(): void;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  export class TarArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  export class JsonArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  // Keep v7-compatible default for transitional imports (runtime may omit it).
  function archiver(format: string, options?: ArchiverOptions): Archiver;
  export default archiver;
}
