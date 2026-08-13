import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { getVendureCliConfigDir, renderStarPrompt, showStarPromptOnce } from './star-prompt';

function createTempDir() {
    return mkdtempSync(path.join(tmpdir(), 'vendure-cli-star-prompt-'));
}

describe('star prompt', () => {
    it('shows once and persists that it was shown', () => {
        const configDir = createTempDir();
        const write = vi.fn();
        try {
            expect(showStarPromptOnce({ configDir, isInteractive: true, color: false, write })).toBe(true);
            expect(write).toHaveBeenCalledOnce();
            expect(write.mock.calls[0][0]).toContain('✨ Thanks for using Vendure.');
            expect(write.mock.calls[0][0]).not.toContain('Vendure. ✨');
            expect(write.mock.calls[0][0]).toContain(
                'If you like the experience, please consider starring us on GitHub',
            );
            expect(write.mock.calls[0][0]).toContain('https://github.com/vendurehq/vendure');
            expect(existsSync(path.join(configDir, 'star-prompted'))).toBe(true);

            expect(showStarPromptOnce({ configDir, isInteractive: true, color: false, write })).toBe(false);
            expect(write).toHaveBeenCalledOnce();
        } finally {
            rmSync(configDir, { recursive: true, force: true });
        }
    });

    it('does not show or persist the prompt in a non-interactive process', () => {
        const configDir = createTempDir();
        const write = vi.fn();
        try {
            expect(showStarPromptOnce({ configDir, isInteractive: false, write })).toBe(false);
            expect(write).not.toHaveBeenCalled();
            expect(existsSync(path.join(configDir, 'star-prompted'))).toBe(false);
        } finally {
            rmSync(configDir, { recursive: true, force: true });
        }
    });

    it('uses the configured XDG directory', () => {
        expect(getVendureCliConfigDir({ XDG_CONFIG_HOME: '/tmp/config' })).toBe(
            path.join('/tmp/config', 'vendure'),
        );
    });

    it('renders a double-line box', () => {
        const output = renderStarPrompt(false);

        expect(output).toContain('╔═');
        expect(output).toContain('═╗');
        expect(output).toContain('╚═');
        expect(output).toContain('═╝');
    });
});
