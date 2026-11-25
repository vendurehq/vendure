import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { anchorName, type Analysis } from './harness/analyze.js';
import { TABLE, waitForList } from './harness/anchors.js';
import { test } from './harness/fixtures.js';
import type { Timeline } from './harness/recorder.js';
import { runScenario, settle, type LayoutContext } from './harness/scenario.js';
import { listVariant } from './harness/variants.js';

/**
 * A survey, not a gate: every list page of the Dashboard is loaded (a cold
 * reload, then one step to the next page) and its layout shift is recorded.
 * It never fails. The table of results is written to
 * test-results/layout-sweep/table.md. It runs only with LAYOUT_SWEEP=1 (see
 * playwright.config.ts): CI has no use for a table nobody reads. The Product
 * list has the full suite in product-list.spec.ts.
 */

const ROUTES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/app/routes');

/** The URL of every route file that renders a ListPage, from the route tree. */
function listRoutes(): string[] {
    const files = fs.readdirSync(ROUTES_DIR, { recursive: true, encoding: 'utf8' });
    return (
        files
            .filter(file => file.endsWith('.tsx'))
            .map(file => fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8'))
            .filter(source => source.includes('<ListPage'))
            .map(source => /createFileRoute\('([^']+)'\)/.exec(source)?.[1])
            .filter((id): id is string => !!id)
            // Segments starting with `_` are pathless layout routes.
            .map(
                id =>
                    '/' +
                    id
                        .split('/')
                        .filter(segment => segment && !segment.startsWith('_'))
                        .join('/'),
            )
            .sort()
    );
}

interface Measure {
    cls: number;
    top: string;
}

/** The element that moved most: the largest anchor change, else the largest layout-shift source. */
function topMover(timeline: Timeline, analysis: Analysis): string {
    const [violation] = [...analysis.violations].sort(
        (a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from),
    );
    if (violation) {
        const delta = Math.round((violation.to - violation.from) * 100) / 100;
        return `${anchorName(timeline.specs, violation.key)} ${violation.prop} ${delta > 0 ? '+' : ''}${delta} px`;
    }
    const [entry] = [...analysis.clsEntries].sort((a, b) => b.value - a.value);
    return entry?.sources[0]?.node.split(' > ').slice(-2).join(' > ') ?? '';
}

async function measure(
    ctx: LayoutContext,
    name: string,
    trigger: (ctx: LayoutContext) => Promise<unknown>,
    prepare: (ctx: LayoutContext) => Promise<unknown>,
): Promise<Measure | string> {
    try {
        const { timeline, analysis } = await runScenario(ctx, { name, prepare, trigger }, []);
        return { cls: analysis.cls, top: topMover(timeline, analysis) };
    } catch (error) {
        return `error: ${(error as Error).message.split('\n')[0]}`;
    }
}

const cell = (m: Measure | string) =>
    typeof m === 'string' ? `${m} |  ` : `${m.cls.toFixed(4)} | ${m.top || '—'}`;

/** Writes through a temporary file, so a worker that reads the folder never sees half a file. */
function writeAtomic(file: string, content: string) {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
}

/** Rebuilds the table from every route measured so far; the last test to finish writes it whole. */
function writeTable(dir: string) {
    const rows = fs
        .readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
        .sort((a, b) => a.route.localeCompare(b.route));
    const lines = [
        '| List | CLS, cold reload | Top move, cold reload | CLS, next page | Top move, next page |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map(r => `| ${r.route} | ${cell(r.reload)} | ${cell(r.paging)} |`),
    ];
    writeAtomic(path.join(dir, 'table.md'), lines.join('\n') + '\n');
}

test.describe('List layout sweep at 1440', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test.describe.configure({ timeout: 120_000 });

    for (const route of listRoutes()) {
        test(route, async ({ layout }, testInfo) => {
            const open = async (ctx: LayoutContext) => {
                if (!new URL(ctx.page.url()).pathname.endsWith(route)) {
                    await ctx.page.goto(route);
                    await waitForList(ctx.page);
                }
            };
            // A full first page and a second one, so every list can page.
            layout.network.rewriteLists(listVariant('fullPage'));

            const reload = await measure(
                layout,
                `cold reload ${route}`,
                ({ page }) => page.reload({ waitUntil: 'commit' }),
                open,
            );
            const paging = await measure(
                layout,
                `next page ${route}`,
                ({ page }) =>
                    page
                        .locator(`${TABLE} [data-slot="table-pagination"]`)
                        .getByRole('button', { name: 'Go to next page' })
                        .click({ timeout: 5_000 }),
                async ctx => {
                    await open(ctx);
                    await settle(ctx);
                },
            );

            const row = { route, reload, paging };
            testInfo.annotations.push({ type: 'layout', description: JSON.stringify(row) });
            const dir = path.join(testInfo.project.outputDir, 'layout-sweep');
            fs.mkdirSync(dir, { recursive: true });
            writeAtomic(path.join(dir, `${route.replace(/\W+/g, '-')}.json`), JSON.stringify(row));
            writeTable(dir);
        });
    }
});
