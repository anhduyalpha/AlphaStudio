/**
 * Characterization for S1 — epoch event versioning (SPEC §6.4).
 *
 * AUDIT PR-5: no existing test covered event versioning or the restart seq
 * reset. This boots the REAL server as a child process twice against one DB
 * (emit → restart → emit) and pins the contract clients depend on:
 *   - every SSE envelope and every workspace snapshot carries `{ epoch, seq }`;
 *   - `seq` is monotonic per workspace within one boot, and lanes are independent;
 *   - a restart mints a NEW epoch and restarts `seq`, so `seq` alone can never
 *     order across boots — the changed epoch is the client's re-hydrate signal.
 *
 * Written before the implementation, per PLAN A2's characterization requirement.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, type ChildProcess } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');
const testData = path.join(repoRoot, 'data-test-epoch-restart');
const entry = path.join(serverRoot, 'src', 'index.ts');

const PORT = 8843;
const base = `http://127.0.0.1:${PORT}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Snapshot = {
  epoch: string;
  seq: number;
  files: { id: string; status: string }[];
};
type Envelope = Record<string, any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let child: ChildProcess | null = null;

/** Boot the real server entry point as a child process and wait for /api/health. */
async function startServer(): Promise<void> {
  const proc = fork(entry, [], {
    cwd: repoRoot,
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: testData,
      DB_PATH: path.join(testData, 'epoch.db'),
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  proc.stderr?.on('data', (c: Buffer) => {
    stderr += String(c);
  });
  child = proc;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`server exited during startup (${proc.exitCode}): ${stderr}`);
    }
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(150);
  }
  throw new Error(`server did not become healthy within 60s: ${stderr}`);
}

/** Graceful stop over the private IPC channel index.ts already exposes. */
async function stopServer(): Promise<void> {
  const proc = child;
  if (!proc) return;
  child = null;
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  const hardKill = setTimeout(() => {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, 20_000);
  try {
    proc.send({ type: 'alphastudio:shutdown' });
  } catch {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }
  await exited;
  clearTimeout(hardKill);
  // Windows can hold SQLite WAL handles briefly after exit
  await sleep(250);
}

async function createWorkspace(): Promise<string> {
  const res = await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route: 'converter' }),
  });
  const text = await res.text();
  assert.equal(res.status, 201, text);
  return JSON.parse(text).id as string;
}

async function snapshot(workspaceId: string): Promise<Snapshot> {
  const res = await fetch(`${base}/api/workspaces/${workspaceId}`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return JSON.parse(text) as Snapshot;
}

async function uploadTinyFile(workspaceId: string, name: string): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([`alpha-${name}`], { type: 'text/plain' }), `${name}.txt`);
  const res = await fetch(`${base}/api/workspaces/${workspaceId}/files`, {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  assert.equal(res.status, 201, text);
}

/**
 * Poll until no file is left `processing`. A file still processing at shutdown
 * is resumed on the next boot (resumeProcessingFiles), which would emit events
 * before the restart assertions run — settle first so the restart is quiet.
 */
async function waitForFilesSettled(workspaceId: string): Promise<Snapshot> {
  const deadline = Date.now() + 30_000;
  let last: Snapshot | null = null;
  while (Date.now() < deadline) {
    last = await snapshot(workspaceId);
    if (last.files.length > 0 && last.files.every((f) => f.status !== 'processing')) return last;
    await sleep(150);
  }
  throw new Error(
    `files never settled: ${JSON.stringify(last?.files?.map((f) => f.status) ?? [])}`,
  );
}

/** Read the workspace SSE stream until stopWhen matches or the timeout fires. */
async function collectSse(
  workspaceId: string,
  stopWhen: (events: Envelope[]) => boolean,
  timeoutMs = 20_000,
): Promise<Envelope[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const events: Envelope[] = [];
  try {
    const res = await fetch(`${base}/api/workspaces/${workspaceId}/events`, {
      headers: { Accept: 'text/event-stream' },
      signal: ac.signal,
    });
    assert.equal(res.status, 200, `SSE status ${res.status}`);
    const body = res.body;
    assert.ok(body, 'SSE body stream');
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() || '';
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            events.push(JSON.parse(line.slice(6)));
          } catch {
            /* ignore keepalives / partials */
          }
        }
      }
      if (stopWhen(events)) {
        ac.abort();
        break;
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  } finally {
    clearTimeout(timer);
  }
  return events;
}

/** Subscribe, upload one file, return the envelopes that were pushed. */
async function emitAndCollect(workspaceId: string, name: string): Promise<Envelope[]> {
  const pending = collectSse(workspaceId, (evs) => evs.some((e) => e.type === 'file.created'));
  await sleep(250); // let the subscription attach before the emit
  await uploadTinyFile(workspaceId, name);
  const events = await pending;
  const emitted = events.filter((e) => e.type !== 'connected');
  assert.ok(
    emitted.length >= 1,
    `expected at least one emitted envelope, got [${events.map((e) => e.type).join(', ')}]`,
  );
  return events;
}

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  fs.mkdirSync(testData, { recursive: true });
  await startServer();
});

after(async () => {
  await stopServer();
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* locked files on Windows — best effort */
  }
});

describe('S1 epoch event versioning (SPEC §6.4)', () => {
  it('snapshots and envelopes carry {epoch, seq}; seq is monotonic per workspace', async () => {
    const ws = await createWorkspace();

    const initial = await snapshot(ws);
    assert.match(initial.epoch, UUID_RE, 'snapshot carries a boot-scoped epoch UUID');
    assert.equal(initial.seq, 0, 'a workspace with no events starts at seq 0');

    const events = await emitAndCollect(ws, 'first');

    const connected = events.find((e) => e.type === 'connected');
    assert.ok(connected, 'connected frame');
    assert.equal(connected.epoch, initial.epoch, 'connected frame carries the boot epoch');
    assert.equal(connected.seq, initial.seq, 'connected frame carries the lane position');

    const emitted = events.filter((e) => e.type !== 'connected');
    for (const ev of emitted) {
      assert.equal(ev.epoch, initial.epoch, `${ev.type} carries the boot epoch`);
      assert.equal(typeof ev.seq, 'number', `${ev.type} carries a numeric seq`);
    }
    const seqs = emitted.map((e) => e.seq as number);
    assert.equal(seqs[0], 1, 'the first event in a fresh lane is seq 1');
    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i] > seqs[i - 1], `seq strictly increases, got [${seqs.join(', ')}]`);
    }

    const settled = await waitForFilesSettled(ws);
    assert.equal(settled.epoch, initial.epoch, 'epoch is stable within a boot');
    assert.ok(
      settled.seq >= Math.max(...seqs),
      `snapshot seq (${settled.seq}) is at least the highest delivered seq (${Math.max(...seqs)})`,
    );
  });

  it('gives each workspace its own seq lane', async () => {
    const wsA = await createWorkspace();
    const wsB = await createWorkspace();

    await uploadTinyFile(wsA, 'lane-a');
    const settledA = await waitForFilesSettled(wsA);
    assert.ok(settledA.seq >= 1, `lane A advanced, seq=${settledA.seq}`);

    const initialB = await snapshot(wsB);
    assert.equal(initialB.seq, 0, 'events in another workspace do not advance this lane');
    assert.equal(initialB.epoch, settledA.epoch, 'epoch is process-wide, not per workspace');

    const events = await emitAndCollect(wsB, 'lane-b');
    const firstB = events.filter((e) => e.type !== 'connected')[0];
    assert.equal(firstB.seq, 1, "lane B starts at 1 regardless of lane A's position");
    await waitForFilesSettled(wsB);
  });

  it('mints a new epoch and restarts seq across a restart (emit → restart → emit)', async () => {
    const ws = await createWorkspace();
    await uploadTinyFile(ws, 'pre-restart');
    const beforeRestart = await waitForFilesSettled(ws);
    const epochA = beforeRestart.epoch;
    const seqA = beforeRestart.seq;
    assert.ok(seqA >= 1, `events were emitted before the restart, seq=${seqA}`);

    await stopServer();
    await startServer();

    const afterRestart = await snapshot(ws);
    assert.match(afterRestart.epoch, UUID_RE);
    assert.notEqual(afterRestart.epoch, epochA, 'a restart mints a new epoch');
    assert.equal(
      afterRestart.seq,
      0,
      'seq is boot-scoped — it does not resume from the previous epoch',
    );
    assert.ok(afterRestart.files.length >= 1, 'same DB — the workspace survived the restart');

    const events = await emitAndCollect(ws, 'post-restart');
    const emitted = events.filter((e) => e.type !== 'connected');
    for (const ev of emitted) {
      assert.equal(ev.epoch, afterRestart.epoch, `${ev.type} carries the new epoch`);
    }
    assert.equal(emitted[0].seq, 1, 'the lane restarts at 1 in the new epoch');
    assert.ok(
      (emitted[0].seq as number) <= seqA,
      'seq alone cannot order across boots — the changed epoch is the re-hydrate signal',
    );
    await waitForFilesSettled(ws);
  });
});
