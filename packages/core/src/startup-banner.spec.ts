import { platformPromotionSnapshot } from '@vendure/common/lib/platform-promotion-snapshot';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DefaultLogger } from './config/logger/default-logger';
import { Logger, LogLevel, VendureLogger } from './config/logger/vendure-logger';
import {
    buildStartupBanner,
    FeaturedCapability,
    getFeaturedCapabilities,
    logStartupBanner,
    StartupBannerInput,
} from './startup-banner';

const identity = (text: string) => text;
// Expected values come from the snapshot, so a snapshot refresh does not break the tests.
const featured = getFeaturedCapabilities();
const day = (offset: number) => new Date(Date.UTC(2026, 9, 19 + offset, 12));
const pickOn = (now: Date) => featured[Math.floor(now.getTime() / 86_400_000) % featured.length];
const baseInput: StartupBannerInput = {
    surface: 'server',
    linked: false,
    box: true,
    hyperlinks: false,
    paint: identity,
    capabilities: featured,
    now: day(0),
};

describe('getFeaturedCapabilities()', () => {
    it('lists the capability of each promoted nav item once, in nav order', () => {
        const expectedKeys = [
            ...new Set(
                platformPromotionSnapshot.navItems.filter(item => item.promoted).map(item => item.capability),
            ),
        ];

        expect(featured).toEqual(
            expectedKeys.map(key => {
                const found = platformPromotionSnapshot.capabilities.find(c => c.key === key);
                return { title: found?.title, summary: found?.summary };
            }),
        );
        expect(featured.length).toBeGreaterThan(0);
    });

    it('skips capabilities that no promoted nav item names, and unknown keys', () => {
        const makeCapability = (key: string) => ({
            key,
            tier: 'growth' as const,
            title: `Title ${key}`,
            summary: `Summary ${key}`,
            benefits: ['a', 'b', 'c'] as [string, string, string],
            cta: 'trial' as const,
        });
        const navItem = (key: string, promoted: boolean) =>
            ({ capability: key, promoted }) as (typeof platformPromotionSnapshot.navItems)[number];

        const result = getFeaturedCapabilities({
            navItems: [navItem('a', true), navItem('b', false), navItem('a', true), navItem('missing', true)],
            capabilities: [makeCapability('b'), makeCapability('a')],
        });

        expect(result).toEqual([{ title: 'Title a', summary: 'Summary a' }]);
    });
});

describe('buildStartupBanner()', () => {
    it('draws a box of equal-width lines for an unlinked project', () => {
        const banner = buildStartupBanner(baseInput);

        expect(banner.kind).toBe('box');
        const lines = banner.text.split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(8);
        expect(lines.length).toBeLessThanOrEqual(11);
        expect(new Set(lines.map(l => l.length)).size).toBe(1);
        expect(banner.text).toContain(`Today's pick: ${pickOn(day(0)).title}.`);
        expect(banner.text).toContain('Vendure Platform: start your free 30-day trial');
        expect(banner.text).toContain('No card needed. Run:  vendure console link');
        expect(banner.text).toContain('vendure.io/pricing');
    });

    it('fits every row in the box on every day of the rotation', () => {
        for (let offset = 0; offset < featured.length; offset++) {
            const lines = buildStartupBanner({ ...baseInput, now: day(offset) }).text.split('\n');

            expect(new Set(lines.map(l => l.length))).toEqual(new Set([58]));
            // Every row keeps 2 spaces of padding before the right border.
            expect(lines.slice(1, -1).every(l => l.endsWith('  │'))).toBe(true);
            // The snapshot copy fits in two lines, so nothing is cut.
            expect(lines.some(l => l.includes('…'))).toBe(false);
        }
    });

    it('rotates the featured capability by day and shows its summary', () => {
        const titles = new Set<string>();
        for (let offset = 0; offset < featured.length; offset++) {
            const pick = pickOn(day(offset));
            const { text } = buildStartupBanner({ ...baseInput, now: day(offset) });

            expect(text).toContain(`Today's pick: ${pick.title}.`);
            expect(text.replace(/[│\s]+/g, ' ')).toContain(pick.summary.slice(0, 20));
            titles.add(pick.title);
        }
        expect(titles.size).toBe(featured.length);
    });

    it('wraps a long summary onto two lines and ends it with an ellipsis when it is longer', () => {
        const capabilities: FeaturedCapability[] = [{ title: 'Long', summary: 'word '.repeat(40).trim() }];
        const lines = buildStartupBanner({ ...baseInput, capabilities, now: day(0) }).text.split('\n');

        expect(new Set(lines.map(l => l.length))).toEqual(new Set([58]));
        expect(lines.filter(l => l.includes('word')).length).toBe(2);
        expect(lines.some(l => l.includes('…'))).toBe(true);
    });

    it('shortens a title that is wider than the box', () => {
        const capabilities: FeaturedCapability[] = [{ title: 'T'.repeat(80), summary: 'Short.' }];
        const lines = buildStartupBanner({ ...baseInput, capabilities }).text.split('\n');

        expect(new Set(lines.map(l => l.length))).toEqual(new Set([58]));
        expect(lines.some(l => l.includes("Today's pick: TTT") && l.includes('…'))).toBe(true);
    });

    it('cuts a single summary word that is wider than the box', () => {
        const capabilities: FeaturedCapability[] = [{ title: 'Long word', summary: `a ${'w'.repeat(90)} b` }];
        const lines = buildStartupBanner({ ...baseInput, capabilities }).text.split('\n');

        expect(new Set(lines.map(l => l.length))).toEqual(new Set([58]));
        expect(lines.some(l => l.includes('www…'))).toBe(true);
    });

    it('keeps the box aligned for titles and summaries of any length', () => {
        for (const length of [1, 20, 39, 40, 52, 53, 54, 55, 100, 400]) {
            const capabilities: FeaturedCapability[] = [
                { title: 'x'.repeat(length), summary: 'y'.repeat(length) },
                { title: 'z'.repeat(length), summary: `${'w '.repeat(length)}` },
            ];
            for (let offset = 0; offset < 2; offset++) {
                const { text } = buildStartupBanner({ ...baseInput, capabilities, now: day(offset) });

                expect(new Set(text.split('\n').map(l => l.length))).toEqual(new Set([58]));
            }
        }
    });

    it('shows a box without capability lines when the list is empty', () => {
        const { text } = buildStartupBanner({ ...baseInput, capabilities: [] });

        expect(text).not.toContain("Today's pick");
        expect(text).not.toContain('Also:');
        expect(text).toContain('Vendure Platform: start your free 30-day trial');
        expect(text).toContain('vendure console link');
        expect(new Set(text.split('\n').map(l => l.length))).toEqual(new Set([58]));
    });

    it('links to the pricing page with the server utm_source', () => {
        const { text } = buildStartupBanner({ ...baseInput, hyperlinks: true });

        expect(text).toContain('\u001b]8;;https://vendure.io/pricing?utm_source=vendure-server\u0007');
    });

    it('links to the pricing page with the worker utm_source', () => {
        const { text } = buildStartupBanner({ ...baseInput, surface: 'worker', hyperlinks: true });

        expect(text).toContain('utm_source=vendure-worker');
    });

    it('keeps the box aligned when the link is a hyperlink', () => {
        const plain = buildStartupBanner(baseInput).text.split('\n');
        // eslint-disable-next-line no-control-regex
        const linked = buildStartupBanner({ ...baseInput, hyperlinks: true })
            .text.split('\n')
            .map(l => l.replace(/\u001b\]8;;[^\u0007]*\u0007/g, ''));

        expect(linked).toEqual(plain);
    });

    it('paints only the frame', () => {
        const { text } = buildStartupBanner({ ...baseInput, paint: t => `<${t}>` });

        expect(text.split('\n')[0]).toMatch(/^<╭─+╮>$/);
        expect(text).toContain('<│>  ★ Vendure Platform');
    });

    it('returns one plain line without box characters when box is false', () => {
        const banner = buildStartupBanner({ ...baseInput, box: false, surface: 'worker' });

        expect(banner.kind).toBe('line');
        expect(banner.text).not.toMatch(/[╭╮╰╯│─\u001b\n]/);
        expect(banner.text).toContain('vendure console link');
        expect(banner.text).toContain('https://vendure.io/pricing?utm_source=vendure-worker');
    });

    it('returns one plan line for a linked project, in a TTY too', () => {
        const banner = buildStartupBanner({ ...baseInput, linked: true });

        expect(banner).toEqual({
            kind: 'line',
            text: 'Manage your Vendure Platform plan: https://console.vendure.io',
        });
    });
});

describe('logStartupBanner()', () => {
    const originalEnv = { ...process.env };
    const originalIsTTY = process.stdout.isTTY;
    let written: string[];
    let infoLines: string[];

    function useCustomLogger() {
        const logger: VendureLogger = {
            error: () => undefined,
            warn: () => undefined,
            info: message => {
                infoLines.push(message);
            },
            verbose: () => undefined,
            debug: () => undefined,
        };
        Logger.useLogger(logger);
    }

    beforeEach(() => {
        written = [];
        infoLines = [];
        for (const key of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'NO_COLOR', 'FORCE_HYPERLINK']) {
            delete process.env[key];
        }
        process.env.TERM = 'xterm-256color';
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
            written.push(String(chunk));
            return true;
        });
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('writes the box to stdout in a TTY with the default logger, unlinked', () => {
        Logger.useLogger(new DefaultLogger());

        logStartupBanner('server');

        expect(written.join('')).toContain('╭');
        expect(written.join('')).toContain('Vendure Platform: start your free 30-day trial');
    });

    it('logs one plain line without a TTY', () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
        Logger.useLogger(new DefaultLogger());
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);

        logStartupBanner('worker');

        expect(info).toHaveBeenCalledTimes(1);
        expect(info.mock.calls[0][0]).toContain('utm_source=vendure-worker');
        expect(written.join('')).not.toContain('╭');
    });

    it('logs one plain line in CI even in a TTY', () => {
        process.env.CI = 'true';
        Logger.useLogger(new DefaultLogger());
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);

        logStartupBanner('server');

        expect(info).toHaveBeenCalledTimes(1);
        expect(written.join('')).not.toContain('╭');
    });

    it('logs one plain line through a custom (for example JSON) logger even in a TTY', () => {
        useCustomLogger();

        logStartupBanner('server');

        expect(infoLines).toHaveLength(1);
        expect(infoLines[0]).not.toContain('╭');
        expect(written).toEqual([]);
    });

    it('logs the plan line for a linked project', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        Logger.useLogger(new DefaultLogger());
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);

        logStartupBanner('server');

        expect(info).toHaveBeenCalledWith('Manage your Vendure Platform plan: https://console.vendure.io');
        expect(written.join('')).not.toContain('╭');
    });

    it('does not throw when reading the project link file throws', () => {
        vi.mocked(fs.existsSync).mockImplementation(() => {
            throw new Error('EACCES');
        });
        Logger.useLogger(new DefaultLogger());

        expect(() => logStartupBanner('server')).not.toThrow();
        expect(written).toEqual([]);
    });

    it('does not throw when a snapshot entry has no summary', () => {
        const promoted = new Set(
            platformPromotionSnapshot.navItems.filter(item => item.promoted).map(item => item.capability),
        );
        const originals = platformPromotionSnapshot.capabilities.map(c => c.summary);
        platformPromotionSnapshot.capabilities.forEach(c => {
            if (promoted.has(c.key)) {
                (c as { summary?: string }).summary = undefined;
            }
        });
        Logger.useLogger(new DefaultLogger());

        try {
            expect(() => logStartupBanner('server')).not.toThrow();
        } finally {
            platformPromotionSnapshot.capabilities.forEach((c, i) => {
                c.summary = originals[i];
            });
        }
    });

    it('prints nothing when the log level hides info messages', () => {
        Logger.useLogger(new DefaultLogger({ level: LogLevel.Warn }));
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);

        logStartupBanner('server');

        expect(info).not.toHaveBeenCalled();
        expect(written).toEqual([]);
    });
});
