/**
 * Vercel / Lambda have no long-running BullMQ workers.
 * Queued sync jobs would stay pending forever without this path.
 */
export const shouldRunJobsInline = () => {
  if (process.env.RUN_SYNC_INLINE === 'true') return true;
  if (process.env.RUN_SYNC_INLINE === 'false') return false;
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
};

/**
 * Prefer Vercel waitUntil so the HTTP response returns immediately and
 * SyncProgressDock can poll live progress while work continues.
 * Falls back to awaiting the work (local / no waitUntil).
 */
export const deferWork = async (work) => {
  const promise = typeof work === 'function' ? work() : work;
  try {
    const { waitUntil } = await import('@vercel/functions');
    if (typeof waitUntil === 'function') {
      waitUntil(promise);
      return 'deferred';
    }
  } catch {
    // @vercel/functions unavailable outside Vercel
  }
  await promise;
  return 'awaited';
};
