/**
 * Minimal vendored replacement for the `progress` npm package. Trimmed to the
 * exact surface used by the Importer (and by the dev-server load-testing
 * benchmark scripts).
 *
 * Supports the format tokens Vendure templates use:
 *
 *   `:bar`       width-aware progress bar (capped to terminal columns)
 *   `:current`   current tick count
 *   `:total`     total tick count
 *   `:percent`   completion percentage (e.g. "42%")
 *   `:etas`      estimated seconds remaining (e.g. "12s")
 *
 * Plus arbitrary custom tokens supplied via `tick({ tokenName: value })`.
 *
 * Renders are throttled (default 16ms between draws) to avoid hammering the
 * terminal. The bar redraws in-place using `\r` and clears the trailing line
 * with `\x1B[2K`. Output goes to `process.stderr` by default to match the
 * upstream `progress` package's behaviour.
 *
 * Deliberately omitted from the upstream surface (none of which the Importer
 * uses): the `head` character on the leading edge of the bar, the `clear`
 * option that wipes the bar on completion, the `:elapsed` and `:rate` tokens,
 * and the `update()` method.
 *
 * Non-TTY behaviour (CI logs, piped output): like upstream `progress`, output
 * is suppressed entirely so log files don't get peppered with `\r\x1B[2K`
 * escape sequences.
 */

const ANSI_CLEAR_LINE = '\x1B[2K';

export interface ProgressBarOptions {
    /** Total number of ticks needed to reach 100%. */
    total: number;
    /** Visible width of the `:bar` token, in characters. Defaults to 40. */
    width?: number;
    /** Character drawn for completed portion of the bar. Default `=`. */
    complete?: string;
    /** Character drawn for incomplete portion of the bar. Default `-`. */
    incomplete?: string;
    /** Minimum time between redraws, in milliseconds. Default 16. */
    renderThrottle?: number;
    /** Output stream. Defaults to `process.stderr`. */
    stream?: NodeJS.WritableStream;
}

export class ProgressBar {
    private readonly fmt: string;
    private readonly total: number;
    private readonly width: number;
    private readonly complete: string;
    private readonly incomplete: string;
    private readonly renderThrottle: number;
    private readonly stream: NodeJS.WritableStream;
    private current = 0;
    private startTime = 0;
    private lastRender = 0;
    private finished = false;

    constructor(fmt: string, options: ProgressBarOptions) {
        this.fmt = fmt;
        this.total = options.total;
        this.width = options.width ?? 40;
        this.complete = options.complete ?? '=';
        this.incomplete = options.incomplete ?? '-';
        this.renderThrottle = options.renderThrottle ?? 16;
        this.stream = options.stream ?? process.stderr;
    }

    /**
     * Advance by 1 (or by the supplied delta if a number is passed). When an
     * object is passed, advance by 1 and substitute each entry as a custom
     * format token (e.g. `:prodName`).
     */
    tick(deltaOrTokens?: number | Record<string, string | number>): void {
        if (this.finished) return;
        let delta = 1;
        let tokens: Record<string, string | number> | undefined;
        if (typeof deltaOrTokens === 'number') {
            delta = deltaOrTokens;
        } else if (deltaOrTokens && typeof deltaOrTokens === 'object') {
            tokens = deltaOrTokens;
        }
        this.current += delta;
        if (this.startTime === 0) {
            this.startTime = Date.now();
        }
        const now = Date.now();
        const isComplete = this.current >= this.total;
        if (!isComplete && now - this.lastRender < this.renderThrottle) {
            return;
        }
        this.lastRender = now;
        this.render(tokens);
        if (isComplete) {
            this.finished = true;
            this.stream.write('\n');
        }
    }

    private render(tokens: Record<string, string | number> | undefined): void {
        // Match the original `progress` package: silent in non-TTY environments
        // (CI logs, file redirects) so we don't spam escape sequences into logs.
        const tty = this.stream as NodeJS.WritableStream & { isTTY?: boolean; columns?: number };
        if (!tty.isTTY) return;

        const ratio = Math.min(Math.max(this.current / this.total, 0), 1);
        const percent = `${Math.floor(ratio * 100)}%`;
        const elapsedMs = Date.now() - this.startTime;
        const etaSeconds = this.current === 0 ? 0 : (elapsedMs / this.current) * (this.total - this.current) / 1000;
        const etas = this.current >= this.total ? '0s' : `${Math.round(etaSeconds)}s`;

        let output = this.fmt
            .replace(':current', String(this.current))
            .replace(':total', String(this.total))
            .replace(':percent', percent)
            .replace(':etas', etas);

        if (output.includes(':bar')) {
            // Cap bar width to whatever space the terminal can show after the
            // non-bar prefix/suffix. Without this, narrow terminals overflow.
            const nonBarLen = output.replace(':bar', '').length;
            const available = Math.max(0, (tty.columns ?? this.width + nonBarLen) - nonBarLen);
            const barWidth = Math.min(this.width, available);
            const completeLength = Math.round(barWidth * ratio);
            const bar =
                this.complete.repeat(completeLength) + this.incomplete.repeat(barWidth - completeLength);
            output = output.replace(':bar', bar);
        }

        if (tokens) {
            for (const [name, value] of Object.entries(tokens)) {
                output = output.replace(`:${name}`, String(value));
            }
        }

        this.stream.write(`\r${ANSI_CLEAR_LINE}${output}`);
    }
}
