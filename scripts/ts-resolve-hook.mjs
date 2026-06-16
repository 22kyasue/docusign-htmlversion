// Tiny ESM resolver hook for running the .ts lib modules directly under Node's
// --experimental-strip-types in tests. The app uses Next's bundler resolution,
// where `import { sha256 } from "./crypto"` (no extension) is fine; raw Node ESM
// demands an extension. This hook appends `.ts` to extensionless RELATIVE imports
// so the test runner resolves them the same way the bundler does — without
// polluting production import statements. Test-only.

import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[mc]?[jt]s$/.test(specifier)) {
    const candidate = new URL(specifier + ".ts", context.parentURL);
    try {
      await stat(fileURLToPath(candidate));
      return next(specifier + ".ts", context);
    } catch {
      // fall through to default resolution
    }
  }
  return next(specifier, context);
}
