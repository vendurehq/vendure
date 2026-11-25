import type { Page, TestInfo } from '@playwright/test';
import fs from 'node:fs';

import { type AllowRule, type Analysis, analyze, report, signature } from './analyze.js';
import type { HeldNetwork } from './network.js';
import { releaseOrders } from './orders.js';
import type { Timeline } from './recorder.js';

export interface LayoutContext {
    page: Page;
    network: HeldNetwork;
    testInfo: TestInfo;
    seed: number;
}

export interface Scenario {
    name: string;
    /** Brings the page to the state before the action. The network passes through. */
    prepare(ctx: LayoutContext): Promise<void>;
    /** The action under test. Every operation it starts is held. */
    trigger(ctx: LayoutContext): Promise<void>;
    /** False when the action requests nothing (row selection). */
    requests?: boolean;
    /** Intended changes. Anything else that moves fails. */
    allow?: AllowRule[];
}

export interface RunResult {
    order: string[];
    /** The operations held in this run, in release order. */
    released: string[];
    timeline: Timeline;
    analysis: Analysis;
    failure?: string;
    /** Same for runs that fail the same way in another order. */
    signature?: string;
}

const MAX_SETTLE_ROUNDS = 50;

/**
 * Waits until the page has finished reacting: released responses handed over,
 * no DOM mutation for three frames, eager images decoded, fonts loaded, and no
 * new request in the meantime. Signals only, no fixed sleep.
 */
export async function settle(ctx: LayoutContext) {
    const { page, network } = ctx;
    for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
        const before = network.requestCount;
        await network.idle();
        await retryOnNavigation(page, () => page.evaluate(quietInPage));
        await network.idle();
        if (network.requestCount === before) return;
    }
}

/** Runs in the page: resolves after three frames without a DOM mutation, with images and fonts loaded. */
async function quietInPage() {
    const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
    let mutated = true;
    const observer = new MutationObserver(() => (mutated = true));
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    let quiet = 0;
    // Bounded: a page that never stops mutating still ends the wait, and the
    // timeline shows what moved.
    for (let i = 0; i < 600 && quiet < 3; i++) {
        mutated = false;
        await frame();
        const loading = Array.from(document.images).some(img => !img.complete && img.loading !== 'lazy');
        quiet = mutated || loading || document.fonts.status === 'loading' ? 0 : quiet + 1;
    }
    observer.disconnect();
}

async function retryOnNavigation<T>(page: Page, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const message = String((error as Error).message);
            const navigating = /Execution context was destroyed|navigation|Target closed|__layout/.test(
                message,
            );
            if (!navigating || attempt >= 20) throw error;
            await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        }
    }
}

/** Starts the recorder in the current document, after every declared font has loaded. */
async function startRecorder(page: Page, label: string) {
    await retryOnNavigation(page, async () => {
        await page.waitForFunction(() => !!window.__layout);
        await page.evaluate(async first => {
            await Promise.all(Array.from(document.fonts).map(face => face.load().catch(() => undefined)));
            await document.fonts.ready;
            if (window.__layout!.running) window.__layout!.setLabel(first);
            else window.__layout!.start(first);
        }, label);
    });
}

async function setLabel(page: Page, label: string) {
    await retryOnNavigation(page, () =>
        page.evaluate(next => {
            const recorder = window.__layout;
            if (!recorder) throw new Error('__layout missing');
            if (recorder.running) recorder.setLabel(next);
            else recorder.start(next);
        }, label),
    );
}

/** Runs a scenario once, releasing held operations by `order` (unknown names last, oldest first). */
export async function runScenario(
    ctx: LayoutContext,
    scenario: Scenario,
    order: string[],
): Promise<RunResult> {
    const { page, network } = ctx;
    network.holding = false;
    await scenario.prepare(ctx);
    await settle(ctx);
    await startRecorder(page, `before ${scenario.name}`);

    network.holding = true;
    await setLabel(page, scenario.name);
    await scenario.trigger(ctx);
    if (scenario.requests !== false) {
        await withTimeout(network.waitForHeld(), 15_000, `${scenario.name} requested nothing`);
    }
    // A full navigation replaced the document: start again in the new one.
    await startRecorder(page, `held: ${network.describeHeld()}`);
    await settle(ctx);

    const released: string[] = [];
    const rank = (name: string) => {
        const i = order.indexOf(name);
        return i === -1 ? order.length : i;
    };
    for (;;) {
        const [next] = network.pending().sort((a, b) => rank(a.name) - rank(b.name) || a.seq - b.seq);
        if (!next) break;
        await setLabel(page, `released: ${next.name}`);
        released.push(next.name);
        await next.release();
        await settle(ctx);
    }
    network.holding = false;
    await setLabel(page, 'settled');
    await page.evaluate(() => window.__layout!.frames(3));
    const timeline = await page.evaluate(() => window.__layout!.stop());

    const analysis = analyze(timeline, scenario.allow);
    const orderText = (order.length ? order : released).join(', ');
    const failure = report(timeline, analysis, orderText);
    if (failure) {
        const file = ctx.testInfo.outputPath(`timeline-${slug(scenario.name)}-${slug(orderText)}.json`);
        fs.writeFileSync(
            file,
            JSON.stringify({ scenario: scenario.name, order, released, ...timeline }, null, 1),
        );
    }
    return {
        order,
        released,
        timeline,
        analysis,
        failure,
        signature: failure ? signature(timeline, analysis) : undefined,
    };
}

/**
 * Runs the scenario once in arrival order to learn which operations it
 * holds, then once per release order of those operations. Throws one error
 * listing the failing orders.
 */
export async function forEachOrder(ctx: LayoutContext, scenario: Scenario): Promise<RunResult[]> {
    const first = await runScenario(ctx, scenario, []);
    const results = [first];
    const arrival = first.released.join(',');
    const orders = releaseOrders(first.released, ctx.seed).filter(o => o.join(',') !== arrival);
    for (const order of orders) results.push(await runScenario(ctx, scenario, order));
    assertClean(ctx, scenario, results);
    return results;
}

/** One run in arrival order. For actions that hold one operation or none. */
export async function once(ctx: LayoutContext, scenario: Scenario): Promise<RunResult> {
    const result = await runScenario(ctx, scenario, []);
    assertClean(ctx, scenario, [result]);
    return result;
}

function assertClean(ctx: LayoutContext, scenario: Scenario, results: RunResult[]) {
    const failed = results.filter(r => r.failure);
    if (failed.length === 0) return;
    const viewport = ctx.page.viewportSize();
    // Runs that fail the same way are reported once, with the count.
    const groups = new Map<string, RunResult[]>();
    for (const r of failed) groups.set(r.signature!, [...(groups.get(r.signature!) ?? []), r]);
    const body = [...groups.values()].map(
        runs =>
            runs[0].failure +
            (runs.length > 1 ? `\n    (the same in ${runs.length - 1} more release orders)` : ''),
    );
    throw new Error(
        `Layout moved in "${scenario.name}" at ${viewport?.width}×${viewport?.height}: ` +
            `${failed.length} of ${results.length} release orders failed (LAYOUT_SEED=${ctx.seed}). ` +
            `Timelines: ${ctx.testInfo.outputDir}\n` +
            body.join('\n'),
    );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        }),
    ]);
}

function slug(text: string) {
    return (
        text
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 80) || 'run'
    );
}
