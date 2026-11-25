import type { APIResponse, Page, Route } from '@playwright/test';

/** Rewrites the `data` of a real response before the page sees it. */
export type ResponseRewrite = (data: any, variables: Record<string, any>) => any;

/** Answers an operation without the server, e.g. a mutation the test must not run. */
export type FakeResponse = (variables: Record<string, any>) => any;

export interface HeldOperation {
    name: string;
    seq: number;
    variables: Record<string, any>;
    release(): Promise<void>;
}

type Answer = { response?: APIResponse; json: any } | undefined;

interface Pending extends HeldOperation {
    route: Route;
    response: Promise<Answer>;
}

const ADMIN_API = /\/admin-api(\?|$)/;

/** The operation name of a GraphQL request body. The Dashboard client sends no `operationName`. */
export function operationName(body: { query?: string; operationName?: string }): string {
    if (body.operationName) return body.operationName;
    const match = /\b(query|mutation|subscription)\s+(\w+)/.exec(body.query ?? '');
    return match?.[2] ?? '(anonymous)';
}

/**
 * Holds Admin API operations on a deferred until the test releases them. The
 * server is asked at once, so a release only hands over a response that is
 * already there: the order of releases is the only variable.
 */
export class HeldNetwork {
    /** While true, every operation waits for a release. */
    holding = false;
    private held: Pending[] = [];
    private seq = 0;
    private arrivalListeners: Array<() => void> = [];
    private inFlight = new Set<Promise<unknown>>();
    private rewrites = new Map<string, ResponseRewrite>();
    private fakes = new Map<string, FakeResponse>();
    private listRewrite: ResponseRewrite | undefined;
    /** Names of the operations that arrived while holding, in arrival order. */
    readonly arrivals: string[] = [];

    constructor(private page: Page) {}

    async install() {
        await this.page.route(ADMIN_API, route => this.onRequest(route));
    }

    rewrite(name: string, fn: ResponseRewrite | undefined) {
        if (fn) this.rewrites.set(name, fn);
        else this.rewrites.delete(name);
    }

    /**
     * Rewrites every paginated list query (one with `options.take`), whatever its
     * name. A rewrite by name takes precedence.
     */
    rewriteLists(fn: ResponseRewrite | undefined) {
        this.listRewrite = fn;
    }

    fake(name: string, fn: FakeResponse | undefined) {
        if (fn) this.fakes.set(name, fn);
        else this.fakes.delete(name);
    }

    /** The operations waiting for a release, oldest first. */
    pending(): HeldOperation[] {
        return [...this.held];
    }

    /** Count of requests seen so far, held or not. */
    get requestCount() {
        return this.seq;
    }

    /** Resolves when an operation is held (at once if one already is). */
    waitForHeld(): Promise<void> {
        if (this.held.length > 0) return Promise.resolve();
        return new Promise(resolve => this.arrivalListeners.push(resolve));
    }

    /** Resolves when every released response has been handed to the page. */
    async idle() {
        while (this.inFlight.size > 0) {
            await Promise.all([...this.inFlight]);
        }
    }

    /** Releases the oldest held operation with this name. */
    async release(name: string) {
        const op = this.held.find(h => h.name === name);
        if (!op) throw new Error(`No held operation named ${name}. Held: ${this.describeHeld()}`);
        await op.release();
    }

    /** Releases everything held, oldest first. */
    async releaseAll() {
        for (const op of [...this.held]) await op.release();
    }

    describeHeld() {
        return this.held.map(h => h.name).join(', ') || '(none)';
    }

    private async onRequest(route: Route) {
        const request = route.request();
        if (request.method() !== 'POST') return route.continue();
        let body: any = {};
        try {
            body = request.postDataJSON() ?? {};
        } catch {
            return route.continue();
        }
        const name = operationName(body);
        const variables = body.variables ?? {};
        const seq = ++this.seq;
        const response = this.respond(route, name, variables);
        if (!this.holding) {
            await this.track(this.fulfill(route, response));
            return;
        }
        let released = false;
        const op: Pending = {
            name,
            seq,
            variables,
            route,
            response,
            release: async () => {
                if (released) return;
                released = true;
                this.held = this.held.filter(h => h !== op);
                await this.track(this.fulfill(route, response));
            },
        };
        this.held.push(op);
        this.arrivals.push(name);
        const listeners = this.arrivalListeners;
        this.arrivalListeners = [];
        listeners.forEach(fn => fn());
    }

    private respond(route: Route, name: string, variables: Record<string, any>): Promise<Answer> {
        const fake = this.fakes.get(name);
        if (fake) return Promise.resolve<Answer>({ json: { data: fake(variables) } });
        const result = route.fetch().then(async response => {
            let json = await response.json();
            const rewrite =
                this.rewrites.get(name) ?? (variables?.options?.take != null ? this.listRewrite : undefined);
            if (rewrite && json?.data) json = { ...json, data: rewrite(json.data, variables) };
            return { response, json };
        });
        // The page closed before the server answered: nothing to hand over.
        return result.catch(() => undefined);
    }

    private async fulfill(route: Route, response: Pending['response']) {
        const answer = await response;
        if (!answer) {
            await route.abort().catch(() => undefined);
            return;
        }
        const { response: real, json } = answer;
        const origin = route.request().headers()['origin'];
        await route
            .fulfill(
                real
                    ? { response: real, json }
                    : {
                          json,
                          headers: {
                              'access-control-allow-origin': origin ?? '*',
                              'access-control-allow-credentials': 'true',
                          },
                      },
            )
            // The page navigated away and dropped the request.
            .catch(() => undefined);
    }

    private track<T>(promise: Promise<T>) {
        this.inFlight.add(promise);
        return promise.finally(() => this.inFlight.delete(promise));
    }
}
