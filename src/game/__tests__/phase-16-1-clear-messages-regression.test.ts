import { describe, expect, it } from 'vitest';
// @ts-expect-error - Vite's `?raw` suffix imports file contents as a plain
// string; there's no type declaration for this project-local path, and
// adding one is unnecessary for a single test file.
import mainSource from '../../main.ts?raw';

/**
 * Phase 16.1 regression test for the `clearMessages()` self-recursion
 * bug that crashed every floor transition with "RangeError: Maximum
 * call stack size exceeded" (see docs/history/phase-16-early-game-
 * balance.md, section 17.2). `main.ts` drives a real Phaser Scene and
 * isn't exercised by this vitest suite (no DOM/Phaser environment is
 * configured here), so a normal call-through unit test isn't available
 * for this method; this is a narrow source-level guard against the
 * exact regression instead of a broad linting rule. Vite's `?raw`
 * import loads main.ts as plain text without needing @types/node.
 */
describe('Phase 16.1: clearMessages() self-recursion regression guard', () => {
  it("main.ts's clearMessages() body calls this.messageLog.clear(), not this.clearMessages()", () => {
    const source = mainSource as string;
    const match = source.match(/private clearMessages\(\): void \{([\s\S]*?)\n {2}\}/);
    expect(match, 'clearMessages() method not found in main.ts').not.toBeNull();
    const body = match![1];
    expect(body).toContain('this.messageLog.clear()');
    expect(body).not.toMatch(/this\.clearMessages\(\)/);
  });
});
