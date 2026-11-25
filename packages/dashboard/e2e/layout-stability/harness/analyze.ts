import type { AnchorProp, AnchorSpec, FrameSample, ShiftEntry, Timeline } from './recorder.js';

/**
 * An intended change: anchors matching `anchor` may change `props` in frames
 * whose label matches `label`. With `node`, a layout-shift entry whose sources
 * all match `node` is part of the change too, and does not count in CLS.
 */
export interface AllowRule {
    anchor: RegExp;
    props?: AnchorProp[];
    label?: RegExp;
    node?: RegExp;
}

export interface Violation {
    frame: FrameSample;
    /** Time of the frame since the recorder started, in ms. */
    at: number;
    key: string;
    prop: AnchorProp;
    from: number;
    to: number;
    shifts: ShiftEntry[];
}

export interface Analysis {
    violations: Violation[];
    cls: number;
    clsEntries: ShiftEntry[];
}

const PROP_VERB: Record<AnchorProp, string> = {
    x: 'moved x',
    y: 'moved y',
    width: 'changed width',
    height: 'changed height',
};

/**
 * Every tracked anchor must keep the value it had in the first frame it
 * appeared in, in every frame, unless a rule allows the change. A change of
 * route (another page) starts over. An allowed change becomes the new value.
 */
export function analyze(timeline: Timeline, allow: AllowRule[] = []): Analysis {
    const specFor = specIndex(timeline.specs);
    const t0 = timeline.labels[0]?.t ?? timeline.frames[0]?.t ?? 0;
    const violations: Violation[] = [];
    const seen = new Set<string>();
    let baseline = new Map<string, number[]>();
    let path: string | undefined;
    let previousT = t0;

    for (const frame of timeline.frames) {
        if (frame.path !== path) {
            path = frame.path;
            baseline = new Map();
        }
        for (const [key, values] of Object.entries(frame.a)) {
            const before = baseline.get(key);
            baseline.set(key, values);
            if (!before) continue;
            const props = specFor(key)?.props ?? [];
            values.forEach((value, i) => {
                const prop = props[i];
                if (value === before[i] || !prop) return;
                if (allowed(allow, key, prop, frame.label)) return;
                const id = `${key}/${prop}`;
                if (seen.has(id)) return;
                seen.add(id);
                violations.push({
                    frame,
                    at: Math.round(frame.t - t0),
                    key,
                    prop,
                    from: before[i],
                    to: value,
                    shifts: timeline.shifts.filter(s => s.t > previousT - 1 && s.t <= frame.t + 1),
                });
            });
        }
        previousT = frame.t;
    }

    const excused = (s: ShiftEntry) =>
        s.sources.length > 0 &&
        s.sources.every(src =>
            allow.some(rule => rule.node?.test(src.node) && (!rule.label || rule.label.test(s.label))),
        );
    const clsEntries = timeline.shifts.filter(s => !s.hadRecentInput && !excused(s));
    const cls = clsEntries.reduce((sum, s) => sum + s.value, 0);
    return { violations, cls, clsEntries };
}

function allowed(rules: AllowRule[], key: string, prop: AnchorProp, label: string) {
    return rules.some(
        rule =>
            rule.anchor.test(key) &&
            (!rule.props || rule.props.includes(prop)) &&
            (!rule.label || rule.label.test(label)),
    );
}

function specIndex(specs: AnchorSpec[]) {
    const byKey = new Map(specs.map(s => [s.key, s]));
    return (key: string) => byKey.get(key.split(':')[0]);
}

export function anchorName(specs: AnchorSpec[], key: string): string {
    const [base, ...rest] = key.split(':');
    const spec = specs.find(s => s.key === base);
    const display = spec?.display ?? base;
    const suffix = rest.join(':');
    if (!suffix) return display;
    if (spec?.firstAndLast) return `${suffix} ${display}`;
    return spec?.each === 'index' ? `${display} ${Number(suffix) + 1}` : `${display} '${suffix}'`;
}

export function when(label: string): string {
    if (label.startsWith('released: ')) return `when ${label.slice('released: '.length)} was released`;
    if (label.startsWith('held: ')) return `while ${label.slice('held: '.length)} was held`;
    return `during "${label}"`;
}

const px = (n: number) => `${Math.round(n * 100) / 100}`;

export function describeViolation(specs: AnchorSpec[], v: Violation, order: string): string {
    const delta = v.to - v.from;
    return (
        `${anchorName(specs, v.key)} ${PROP_VERB[v.prop]} ${px(v.from)} → ${px(v.to)} ` +
        `(${delta > 0 ? '+' : ''}${px(delta)} px) ${when(v.frame.label)} (order: [${order}])`
    );
}

export function describeShift(s: ShiftEntry): string {
    const sources = s.sources
        .map(
            src =>
                `      ${src.node}: [${src.previous.join(', ')}] → [${src.current.join(', ')}] (x, y, width, height)`,
        )
        .join('\n');
    return `    layout-shift ${s.value.toFixed(4)} at ${Math.round(s.t)} ms ${when(s.label)}${
        s.hadRecentInput ? ' (after input, not counted in CLS)' : ''
    }\n${sources}`;
}

const MAX_SHIFTS = 6;
const MAX_SOURCES = 3;

function describeShifts(shifts: ShiftEntry[]): string[] {
    const lines = shifts.slice(0, MAX_SHIFTS).map(s => {
        const extra = s.sources.length > MAX_SOURCES ? { ...s, sources: s.sources.slice(0, MAX_SOURCES) } : s;
        const more = s.sources.length - MAX_SOURCES;
        return describeShift(extra) + (more > 0 ? `\n      … ${more} more sources` : '');
    });
    if (shifts.length > MAX_SHIFTS)
        lines.push(`    … ${shifts.length - MAX_SHIFTS} more layout-shift entries`);
    return lines;
}

/**
 * The failure report of one run, or undefined when it is clean. `order` names
 * the release order in the first line; the other lines leave it out.
 */
export function report(timeline: Timeline, analysis: Analysis, order: string): string | undefined {
    if (analysis.violations.length === 0 && analysis.cls === 0) return undefined;
    const lines: string[] = [];
    const [first, ...rest] = analysis.violations;
    if (first) {
        lines.push(`  ${describeViolation(timeline.specs, first, order)}`);
        lines.push(`    first bad frame: ${first.at} ms, state "${first.frame.label}"`);
        lines.push(...describeShifts(first.shifts));
        for (const v of rest)
            lines.push(`  ${describeViolation(timeline.specs, v, '').replace(/ \(order: \[\]\)$/, '')}`);
    }
    if (analysis.cls > 0) {
        lines.push(`  CLS ${analysis.cls.toFixed(4)} (expected 0)`);
        lines.push(...describeShifts(analysis.clsEntries));
    }
    return lines.join('\n');
}

/** A run's failure without its timings and order, to group runs that fail the same way. */
export function signature(timeline: Timeline, analysis: Analysis): string {
    return [
        ...analysis.violations.map(v => describeViolation(timeline.specs, v, '')),
        analysis.cls > 0 ? `CLS ${analysis.cls.toFixed(3)}` : '',
    ].join('\n');
}
