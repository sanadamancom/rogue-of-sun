import { configDefaults, defineConfig } from 'vitest/config';

const layerAContractTest = 'src/game/__tests__/phase-24-6c5-generation-audit.contract.test.ts';
const runsLayerAContractAudit = process.argv.some((argument) => argument.replaceAll('\\', '/').endsWith(layerAContractTest));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: runsLayerAContractAudit
      ? configDefaults.exclude
      : [...configDefaults.exclude, '**/*.contract.test.ts'],
  },
});
