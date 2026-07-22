import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { detectCapabilities } from '../capabilities.js';
import { getWorkerDiagnostics, getWorkerPoolStats } from '../workers/jobs.js';
import { capabilitySnapshot, publicCapabilitySnapshot } from '../convert/engines/index.js';
import { PDF_OPERATION_DESCRIPTORS } from '../pdf/operation-contract.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    // In-memory only: health must not wait for SQLite, tool probes, or workers.
    const workers = getWorkerPoolStats();
    return {
      ok: true,
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      workers: {
        active: workers.activeCount,
        configured: workers.maxConcurrentJobs,
      },
    };
  });

  app.get('/api/version', async () => ({
    name: 'alphastudio-server',
    version: config.version,
    node: process.version,
  }));

  app.get('/api/capabilities', async (req) => {
    const query = req.query as { refresh?: string };
    const refresh = query.refresh === '1' || query.refresh === 'true';
    const caps = detectCapabilities(refresh);
    return {
      version: config.version,
      detectedAt: caps.detectedAt,
      binaries: Object.fromEntries(
        Object.entries(caps.binaries).map(([id, binary]) => [
          id,
          {
            name: binary.name,
            available: binary.available,
            version: binary.version,
          },
        ]),
      ),
      tools: caps.tools,
      pdf: {
        operations: PDF_OPERATION_DESCRIPTORS,
      },
      converter: publicCapabilitySnapshot(capabilitySnapshot(refresh)),
      limits: {
        maxUploadBytes: config.maxUploadBytes,
        maxOutputBytes: config.maxOutputBytes,
        maxConcurrentJobs: config.maxConcurrentJobs,
        workerCategoryLimits: config.workerCategoryLimits,
        jobTimeoutMs: config.jobTimeoutMs,
      },
    };
  });

  app.get('/api/diagnostics', async () => ({
    version: config.version,
    generatedAt: new Date().toISOString(),
    workerPool: getWorkerDiagnostics(),
  }));
}
