import { defineConfig } from 'tsup';

// One self-contained file for the host to run. `shared/` is raw TypeScript (the workspace package
// points at src/index.ts), so it is bundled in; real npm dependencies stay external and are
// installed on the host.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  noExternal: ['@whiteboard/shared'],
});
