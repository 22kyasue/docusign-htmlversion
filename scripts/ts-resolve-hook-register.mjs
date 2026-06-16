// Registers the test-only .ts resolver hook (see ts-resolve-hook.mjs) on the
// module loader thread, then it applies to all subsequent imports in the run.
import { register } from "node:module";

register(new URL("./ts-resolve-hook.mjs", import.meta.url));
