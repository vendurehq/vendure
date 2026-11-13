import { DashboardPromotionV1 } from '@vendure/common/lib/platform-promotion';
import { platformPromotionSnapshot } from '@vendure/common/lib/platform-promotion-snapshot';
import { supportsHyperlinks } from '@vendure/common/lib/supports-hyperlinks';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

import { DefaultLogger } from './config/logger/default-logger';
import { Logger, LogLevel } from './config/logger/vendure-logger';
import { isCI } from './telemetry/helpers/ci-detector.helper';

export type StartupBannerSurface = 'server' | 'worker';

const PRICING_URL = 'https://vendure.io/pricing';
const CONSOLE_URL = 'https://console.vendure.io';
const LINK_COMMAND = 'vendure console link';
const BOX_INNER_WIDTH = 56;
// The Vendure brand color (#17C1FF). Terminals without 24-bit color get cyan.
const BRAND_RGB = '38;2;23;193;255';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface FeaturedCapability {
    title: string;
    summary: string;
}

// The summary may take this many box lines. A longer one ends with an ellipsis.
const MAX_SUMMARY_LINES = 2;

/**
 * The capabilities of the promoted navigation items in the Platform catalog snapshot, in
 * navigation order, without duplicates. The snapshot ships in `@vendure/common`, so startup
 * makes no network call.
 */
export function getFeaturedCapabilities(
    promotion: Pick<DashboardPromotionV1, 'navItems' | 'capabilities'> = platformPromotionSnapshot,
): FeaturedCapability[] {
    const keys = new Set(promotion.navItems.filter(item => item.promoted).map(item => item.capability));
    const featured: FeaturedCapability[] = [];
    for (const key of keys) {
        const capability = promotion.capabilities.find(c => c.key === key);
        if (capability) {
            featured.push({ title: capability.title, summary: capability.summary });
        }
    }
    return featured;
}

/** Cuts `text` to `width` characters and ends it with an ellipsis when it is longer. */
function fit(text: string, width: number): string {
    return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/**
 * Wraps `text` into at most `maxLines` lines of at most `width` characters. A word longer than
 * `width`, and text that needs more lines, ends with an ellipsis.
 */
function wrap(text: string, width: number, maxLines: number): string[] {
    const lines: string[] = [];
    let current = '';
    for (const word of text.split(' ')) {
        if (current && `${current} ${word}`.length > width) {
            lines.push(current);
            current = word;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    lines.push(current);
    const kept = lines.slice(0, maxLines).map(line => fit(line, width));
    if (lines.length > maxLines) {
        kept[maxLines - 1] = fit(`${kept[maxLines - 1].replace(/…$/, '')}…`, width);
    }
    return kept;
}

export interface StartupBannerInput {
    surface: StartupBannerSurface;
    /** Whether `.vendure/project.json` exists in the working directory. */
    linked: boolean;
    /** Whether to draw the box. When false, the banner is one plain line. */
    box: boolean;
    hyperlinks: boolean;
    /** Colors the box frame. Pass an identity function for no color. */
    paint: (text: string) => string;
    /** One of these is the pick of the day. With none, the box has no capability lines. */
    capabilities: FeaturedCapability[];
    now: Date;
}

export type StartupBanner = { kind: 'box'; text: string } | { kind: 'line'; text: string };

export function buildStartupBanner(input: StartupBannerInput): StartupBanner {
    const { surface, linked, box, hyperlinks, paint, capabilities, now } = input;
    if (linked) {
        return { kind: 'line', text: `Manage your Vendure Platform plan: ${CONSOLE_URL}` };
    }
    const pricingUrl = `${PRICING_URL}?utm_source=vendure-${surface}`;
    if (!box) {
        return {
            kind: 'line',
            text: `Vendure Platform: start your free 30-day trial. No card needed. Run: ${LINK_COMMAND} (${pricingUrl})`,
        };
    }

    const contentWidth = BOX_INNER_WIDTH - 2;
    // Wrapped text leaves the same 2 spaces of padding on the right as on the left.
    const textWidth = contentWidth - 2;
    const capabilityRows: string[] = [];
    if (capabilities.length > 0) {
        const index = Math.floor(now.getTime() / MS_PER_DAY) % capabilities.length;
        const pick = capabilities[index];
        capabilityRows.push(
            '',
            fit(`Today's pick: ${pick.title}.`, textWidth),
            ...wrap(pick.summary, textWidth, MAX_SUMMARY_LINES),
        );
        // Name as many other capabilities as fit on one line.
        let also = 'Also:';
        for (let offset = 1; offset < capabilities.length; offset++) {
            const next = `${also}${offset === 1 ? ' ' : ', '}${capabilities[(index + offset) % capabilities.length].title}`;
            if (next.length > textWidth) {
                break;
            }
            also = next;
        }
        if (also !== 'Also:') {
            capabilityRows.push(also);
        }
    }
    const linkLabel = 'vendure.io/pricing';
    const link = hyperlinks ? `\u001b]8;;${pricingUrl}\u0007${linkLabel}\u001b]8;;\u0007` : linkLabel;

    // The hyperlink escape adds no visible width, so the last row pads by its label.
    const rows: Array<[visible: string, rendered: string]> = [
        ...[
            '★ Vendure Platform: start your free 30-day trial',
            ...capabilityRows,
            '',
            `No card needed. Run:  ${LINK_COMMAND}`,
        ].map((text): [string, string] => [text, text]),
        [linkLabel, link],
    ];
    const horizontal = '─'.repeat(BOX_INNER_WIDTH);
    const lines = [
        paint(`╭${horizontal}╮`),
        ...rows.map(([visible, rendered]) => {
            const padding = ' '.repeat(Math.max(0, contentWidth - visible.length));
            return `${paint('│')}  ${rendered}${padding}${paint('│')}`;
        }),
        paint(`╰${horizontal}╯`),
    ];
    return { kind: 'box', text: lines.join('\n') };
}

function brandPainter(): (text: string) => string {
    if (!pc.isColorSupported) {
        return text => text;
    }
    const { COLORTERM } = process.env;
    if (COLORTERM === 'truecolor' || COLORTERM === '24bit') {
        return text => `\u001b[${BRAND_RGB}m${text}\u001b[39m`;
    }
    return pc.cyan;
}

/**
 * Logs the Vendure Platform banner as the last startup output of the server or worker.
 *
 * An interactive terminal with the default logger gets a colored box on stdout. Everything else
 * (no TTY, CI, a custom logger such as a JSON logger) gets one plain `Logger` line. Reads one
 * local file and makes no network call.
 */
export function logStartupBanner(surface: StartupBannerSurface): void {
    // The banner is promotional text. Nothing in it may fail the start of the server or worker.
    try {
        const logger = Logger.logger;
        if (logger instanceof DefaultLogger && logger.level < LogLevel.Info) {
            return;
        }
        const interactive =
            logger instanceof DefaultLogger &&
            process.stdout.isTTY === true &&
            !isCI() &&
            process.env.TERM !== 'dumb';
        const banner = buildStartupBanner({
            surface,
            linked: fs.existsSync(path.join(process.cwd(), '.vendure', 'project.json')),
            box: interactive,
            hyperlinks: supportsHyperlinks(),
            paint: brandPainter(),
            capabilities: getFeaturedCapabilities(),
            now: new Date(),
        });
        if (banner.kind === 'box') {
            process.stdout.write(`${banner.text}\n`);
        } else {
            Logger.info(banner.text);
        }
    } catch {
        // Show no banner.
    }
}
