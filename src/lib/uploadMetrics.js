/**
 * Pure multipart-upload progress math shared by the HTTP transport.
 */
export function computeUploadMetrics(loaded, total, elapsedMs) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeLoaded = Math.max(
    0,
    Math.min(Number(loaded) || 0, safeTotal || Number(loaded) || 0),
  );
  const percent = safeTotal > 0
    ? Math.min(100, Math.round((safeLoaded / safeTotal) * 100))
    : 0;
  const elapsedSeconds = Math.max(0.001, (Number(elapsedMs) || 0) / 1000);
  const speedBps = safeLoaded / elapsedSeconds;
  const etaSeconds = safeTotal > safeLoaded && speedBps > 0
    ? (safeTotal - safeLoaded) / speedBps
    : 0;
  return {
    loaded: safeLoaded,
    total: safeTotal,
    percent,
    speedBps,
    etaSeconds,
  };
}
