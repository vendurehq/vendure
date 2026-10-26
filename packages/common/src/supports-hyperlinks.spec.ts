import { describe, expect, it } from 'vitest';

import { supportsHyperlinks } from './supports-hyperlinks';

describe('supportsHyperlinks()', () => {
    it.each([
        ['iTerm.app', { TERM_PROGRAM: 'iTerm.app' }],
        ['VS Code', { TERM_PROGRAM: 'vscode' }],
        ['WezTerm', { TERM_PROGRAM: 'WezTerm' }],
        ['Warp', { TERM_PROGRAM: 'WarpTerminal' }],
        ['Windows Terminal', { WT_SESSION: 'abc' }],
        ['kitty', { TERM: 'xterm-kitty' }],
        ['Ghostty', { TERM: 'xterm-ghostty' }],
        ['Alacritty', { TERM: 'alacritty' }],
        ['foot', { TERM: 'foot' }],
        ['VTE 5000 or newer', { VTE_VERSION: '5000' }],
        ['FORCE_HYPERLINK, even without a TTY', { FORCE_HYPERLINK: '1' }, false],
    ])('is true for %s', (_name, env, isTTY = true) => {
        expect(supportsHyperlinks(env, isTTY)).toBe(true);
    });

    it.each([
        ['an unknown terminal', { TERM_PROGRAM: 'Apple_Terminal' }, true],
        ['plain xterm', { TERM: 'xterm-256color' }, true],
        ['VTE older than 5000', { VTE_VERSION: '4999' }, true],
        ['stdout that is not a TTY', { TERM_PROGRAM: 'iTerm.app' }, false],
        ['CI, even for kitty', { TERM: 'xterm-kitty', CI: 'true' }, true],
        ['CI', { TERM_PROGRAM: 'iTerm.app', CI: 'true' }, true],
        ['FORCE_HYPERLINK=0', { TERM_PROGRAM: 'iTerm.app', FORCE_HYPERLINK: '0' }, true],
    ])('is false for %s', (_name, env, isTTY) => {
        expect(supportsHyperlinks(env, isTTY)).toBe(false);
    });
});
