import { describe, expect, it, vi } from 'vitest';

import { getConsoleHint, showConsoleHint } from './console-hint';

const PLAIN =
    'Paid plans add 30+ features and include Vendure Cloud: https://vendure.io/pricing. Already on a plan? Run `vendure console link`.';
const LINKED =
    'Paid plans add 30+ features and include Vendure Cloud: ' +
    '\u001b]8;;https://vendure.io/pricing?utm_source=vendure-create\u0007https://vendure.io/pricing\u001b]8;;\u0007' +
    '. Already on a plan? Run `vendure console link`.';

describe('getConsoleHint()', () => {
    // OSS-882 - a terminal with hyperlink support shows the bare URL and links to the tagged one.
    it('wraps the pricing URL in an OSC 8 hyperlink that carries the utm_source tag', () => {
        expect(getConsoleHint(true)).toBe(LINKED);
    });

    // OSS-882 - other terminals get the plain URL without the tag.
    it('prints the plain pricing URL without the tag when hyperlinks are not supported', () => {
        expect(getConsoleHint(false)).toBe(PLAIN);
        expect(getConsoleHint(false)).not.toContain('utm_source');
    });
});

describe('showConsoleHint()', () => {
    it('writes the hint as one line', () => {
        const write = vi.fn();

        showConsoleHint(write);

        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][0]).not.toContain('\n');
    });
});
