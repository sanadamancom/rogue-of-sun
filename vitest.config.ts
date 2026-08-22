import { configDefaults, defineConfig } from 'vitest/config';

const contractTests = [
  'src/game/__tests__/phase-24-6c5-generation-audit.contract.test.ts',
  'src/game/__tests__/phase-24-7d-sealed-room-distribution.contract.test.ts',
];
const runsContractAudit = process.argv.some((argument) =>
  contractTests.some((test) => argument.replaceAll('\\', '/').endsWith(test)),
);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: runsContractAudit
      ? configDefaults.exclude
      : [...configDefaults.exclude, '**/*.contract.test.ts'],
  },
});
