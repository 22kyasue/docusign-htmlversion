// Runs once per server start (Node runtime). We kick off the recovery
// reconciler fire-and-forget: it re-fires any dropped completion webhooks and
// re-asserts read-only on signed files. It must NOT block server readiness on a
// slow/down cockpit, so we do not await it here — it has its own bounded
// timeouts and records its own outcomes.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runReconciler } = await import("./lib/reconciler");
  void runReconciler().catch(() => {
    // recovery is best-effort; failures are logged inside the reconciler
  });
}
