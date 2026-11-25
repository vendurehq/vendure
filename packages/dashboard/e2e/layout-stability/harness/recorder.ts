/**
 * The in-page recorder. Installed with `addInitScript`, so it exists in every
 * document before the app runs. Once started, it reads the rects of the tracked
 * anchors on every animation frame and keeps the layout-shift entries, each
 * labelled with the harness state the test set last.
 *
 * This file is serialised into the page: the function must not close over
 * anything from the test process.
 */

export type AnchorProp = 'x' | 'y' | 'width' | 'height';

export interface AnchorSpec {
    /** Key in the timeline, e.g. `header`. With `each`, one key per match: `header:Name`. */
    key: string;
    /** How a failure message names it, e.g. `table header`. */
    display: string;
    selector: string;
    props: AnchorProp[];
    /** Track every match, labelled by its text (`text`) or its index (`index`). */
    each?: 'text' | 'index';
    /** With `each: 'index'`, only the first and last match. */
    firstAndLast?: boolean;
    /** Read `scrollHeight` as `height` (for the content area). */
    scrollHeight?: boolean;
}

export interface FrameSample {
    /** `performance.now()` of the frame. */
    t: number;
    label: string;
    path: string;
    /** Anchor key → values in the order of the spec's `props`. */
    a: Record<string, number[]>;
}

export interface ShiftSource {
    node: string;
    previous: [number, number, number, number];
    current: [number, number, number, number];
}

export interface ShiftEntry {
    t: number;
    label: string;
    value: number;
    hadRecentInput: boolean;
    sources: ShiftSource[];
}

export interface Timeline {
    specs: AnchorSpec[];
    frames: FrameSample[];
    shifts: ShiftEntry[];
    labels: Array<{ t: number; label: string }>;
}

export interface LayoutRecorder {
    running: boolean;
    start(label: string): void;
    setLabel(label: string): void;
    stop(): Timeline;
    /** Resolves after `n` animation frames. */
    frames(n: number): Promise<void>;
}

declare global {
    interface Window {
        __layout?: LayoutRecorder;
    }
}

export function installRecorder(specs: AnchorSpec[]) {
    const round = (n: number) => Math.round(n * 100) / 100;
    let running = false;
    let label = '';
    let frames: FrameSample[] = [];
    let shifts: ShiftEntry[] = [];
    let labels: Array<{ t: number; label: string }> = [];
    let startedAt = 0;

    const describe = (node: Node | null | undefined): string => {
        if (!node || !(node instanceof Element)) return node ? node.nodeName.toLowerCase() : '(removed)';
        const parts: string[] = [];
        let el: Element | null = node;
        while (el && parts.length < 4 && el !== document.body) {
            let part = el.tagName.toLowerCase();
            const slot = el.getAttribute('data-slot');
            const testId = el.getAttribute('data-testid');
            if (testId) part += `[data-testid="${testId}"]`;
            else if (slot) part += `[data-slot="${slot}"]`;
            else if (el.parentElement) {
                const index = Array.from(el.parentElement.children).indexOf(el) + 1;
                part += `:nth-child(${index})`;
            }
            parts.unshift(part);
            if (testId) break;
            el = el.parentElement;
        }
        return parts.join(' > ');
    };

    const rect = (r: DOMRectReadOnly): [number, number, number, number] => [
        round(r.x),
        round(r.y),
        round(r.width),
        round(r.height),
    ];

    const sample = (): Record<string, number[]> => {
        const out: Record<string, number[]> = {};
        for (const spec of specs) {
            const read = (el: Element, key: string) => {
                // Not rendered (display: none, detached): absent in this frame.
                if (!el.isConnected || el.getClientRects().length === 0) return;
                const r = el.getBoundingClientRect();
                out[key] = spec.props.map(p =>
                    p === 'height' && spec.scrollHeight ? round(el.scrollHeight) : round(r[p]),
                );
            };
            if (!spec.each) {
                const el = document.querySelector(spec.selector);
                if (el) read(el, spec.key);
                continue;
            }
            const all = Array.from(document.querySelectorAll(spec.selector));
            if (spec.firstAndLast) {
                if (all.length > 0) {
                    read(all[0], `${spec.key}:first`);
                    read(all[all.length - 1], `${spec.key}:last`);
                }
                continue;
            }
            all.forEach((el, index) => {
                const name =
                    spec.each === 'text' ? (el.textContent ?? '').trim() || `#${index}` : String(index);
                read(el, `${spec.key}:${name}`);
            });
        }
        return out;
    };

    const tick = (t: number) => {
        if (!running) return;
        frames.push({ t: round(t), label, path: location.pathname, a: sample() });
        requestAnimationFrame(tick);
    };

    const record = (entries: PerformanceEntryList) => {
        for (const entry of entries as any[]) {
            if (!running || entry.startTime < startedAt) continue;
            const at = labels.filter(l => l.t <= entry.startTime).pop();
            shifts.push({
                t: round(entry.startTime),
                label: at?.label ?? label,
                value: entry.value,
                hadRecentInput: entry.hadRecentInput,
                sources: (entry.sources ?? []).map((s: any) => ({
                    node: describe(s.node),
                    previous: rect(s.previousRect),
                    current: rect(s.currentRect),
                })),
            });
        }
    };
    const observer = new PerformanceObserver(list => record(list.getEntries()));
    try {
        observer.observe({ type: 'layout-shift', buffered: true });
    } catch {
        // Not supported: the anchor timeline still runs.
    }

    const recorder: LayoutRecorder = {
        get running() {
            return running;
        },
        start(first: string) {
            frames = [];
            shifts = [];
            labels = [];
            startedAt = performance.now();
            running = true;
            recorder.setLabel(first);
            requestAnimationFrame(tick);
        },
        setLabel(next: string) {
            label = next;
            labels.push({ t: round(performance.now()), label: next });
        },
        stop() {
            // Entries the observer has not delivered yet.
            record(observer.takeRecords());
            running = false;
            return { specs, frames, shifts, labels };
        },
        frames(n: number) {
            return new Promise<void>(resolve => {
                let left = n;
                const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
                requestAnimationFrame(step);
            });
        },
    };
    window.__layout = recorder;
}
