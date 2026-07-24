// 'vitest/runtime' is the canonical entry on Vitest >= 4.1: importing from
// the older 'vitest/environments' now emits a deprecation warning at runtime.
import { builtinEnvironments } from 'vitest/runtime';
import type { Environment } from 'vitest/runtime';

// The builtin `node` environment transforms modules through the `ssr` vite
// environment, which makes @vitejs/plugin-vue compile SFCs in SSR mode
// (setup gets wrapped in useSSRContext()) — such components cannot be mounted
// by a client renderer in component tests. This environment behaves exactly
// like `node` (no DOM is provided; tests stub what they need) but requests
// client-mode transforms so .vue imports compile to regular render functions.
const environment: Environment = {
    ...builtinEnvironments.node,
    name: 'node-client',
    viteEnvironment: 'client',
};

export default environment;
