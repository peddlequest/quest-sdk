import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  target: 'es2020',
  // viem is a peer: never bundled, always the integrator's copy.
  external: ['viem'],
});
