/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
/**
 * Load harness for order concurrency control (OSS-1011, #4152).
 *
 * Not an assertion suite. Each scenario fires genuinely concurrent requests through the Shop and
 * Admin APIs for a number of trials, and records which trials ended in a state a serialized
 * execution could not have produced, which database errors occurred, and the latencies. The
 * results are written to a JSON file, so that runs on different databases or branches can be
 * compared.
 *
 * Run from packages/core against a real database (sql.js serializes every write, so nothing can
 * race there):
 *
 *     DB=postgres bun run bench order-concurrency
 *
 * Env:
 *   BENCH_SCENARIOS  comma-separated scenario names, default all correctness scenarios. Add
 *                    `throughput`, `hotCart` and `paymentPileUp` for the latency scenarios.
 *   BENCH_TRIALS     trials per correctness scenario (default 20)
 *   BENCH_OUT        output JSON path (default /tmp/order-concurrency-<variant>-<db>.json)
 *   BENCH_VARIANT    label written to the results, e.g. the branch name
 *   BENCH_PORT       API port, so that several databases can be benchmarked at once
 *   BENCH_PAYMENT_DELAY_MS  latency of the payment handler, to model a payment provider call
 *   BENCH_P, BENCH_ROUNDS, BENCH_H, BENCH_B  size of the throughput and hotCart scenarios
 *   BENCH_K, BENCH_R  orders, and payment attempts per order, of the paymentPileUp scenario
 */
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DefaultLogger, LogLevel, mergeConfig, PaymentMethodHandler, VendureLogger } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import fs from 'fs';
import { parse } from 'graphql';
import path from 'path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const DB = process.env.DB ?? 'sqljs';
const VARIANT = process.env.BENCH_VARIANT ?? 'unknown';
const OUT = process.env.BENCH_OUT ?? `/tmp/order-concurrency-${VARIANT}-${DB}.json`;
const TRIALS = +(process.env.BENCH_TRIALS ?? 20);
const PAYMENT_DELAY_MS = +(process.env.BENCH_PAYMENT_DELAY_MS ?? 0);
const SCENARIOS = (
    process.env.BENCH_SCENARIOS ??
    'fanoutExisting,fanoutFresh,mixedSetters,lastUnit,doublePayment,payVsBackToCart,overlappingAllocations,loginDuringCartMutation,setCustomerVsPay'
).split(',');

// ---------------------------------------------------------------- capture

const serverErrors: Array<{ t: number; message: string; context?: string }> = [];
class CapturingLogger implements VendureLogger {
    private inner = new DefaultLogger({ level: LogLevel.Error });
    error(message: string, context?: string, trace?: string) {
        serverErrors.push({ t: Date.now(), message: String(message).slice(0, 300), context });
    }
    warn(message: string, context?: string) {
        if (/deadlock|lock|serializ|Record has changed|aborted/i.test(String(message))) {
            serverErrors.push({ t: Date.now(), message: 'WARN ' + String(message).slice(0, 300), context });
        }
    }
    info() {
        /* */
    }
    verbose() {
        /* */
    }
    debug() {
        /* */
    }
}

const slowPaymentMethod = new PaymentMethodHandler({
    code: 'load-payment-method',
    description: [{ languageCode: LanguageCode.en, value: 'Load test payment' }],
    args: {},
    createPayment: async (ctx, order, amount) => {
        if (PAYMENT_DELAY_MS) {
            await new Promise(r => setTimeout(r, PAYMENT_DELAY_MS));
        }
        return { amount, state: 'Settled', transactionId: `tx-${order.code}-${Date.now()}`, metadata: {} };
    },
    settlePayment: () => ({ success: true }),
});

/** Categorise an error message into a stable bucket. */
function classify(message: string): string {
    const m = message.toLowerCase();
    if (/deadlock/.test(m)) return 'deadlock';
    if (/lock wait timeout/.test(m)) return 'lock-wait-timeout';
    if (/record has changed since last read|er_checkread|1020/.test(m))
        return 'snapshot-isolation (ER_CHECKREAD)';
    if (/could not serialize|40001/.test(m)) return 'serialization-failure';
    if (/current transaction is aborted/.test(m)) return 'tx-aborted';
    if (/duplicate|unique/.test(m)) return 'unique-violation';
    if (/timeout|timed out/.test(m)) return 'timeout';
    return 'other: ' + message.slice(0, 120);
}

// ---------------------------------------------------------------- documents

const ORDER_FIELDS = `
    id code state active subTotal subTotalWithTax shipping total totalWithTax totalQuantity
    lines { id quantity linePrice linePriceWithTax productVariant { id } }
    shippingLines { priceWithTax shippingMethod { id } }
    customer { id emailAddress }
    shippingAddress { streetLine1 }
    billingAddress { streetLine1 }
    payments { id state amount }
`;
const RESULT = `... on Order { id } ... on ErrorResult { errorCode message }`;

const D = {
    activeOrder: parse(`query { activeOrder { ${ORDER_FIELDS} } }`),
    addItem: parse(
        `mutation($v: ID!, $q: Int!) { addItemToOrder(productVariantId: $v, quantity: $q) { ${RESULT} ... on InsufficientStockError { quantityAvailable } } }`,
    ),
    setCustomer: parse(
        `mutation($input: CreateCustomerInput!) { setCustomerForOrder(input: $input) { ${RESULT} } }`,
    ),
    setShipping: parse(
        `mutation($input: CreateAddressInput!) { setOrderShippingAddress(input: $input) { ${RESULT} } }`,
    ),
    setBilling: parse(
        `mutation($input: CreateAddressInput!) { setOrderBillingAddress(input: $input) { ${RESULT} } }`,
    ),
    eligibleShipping: parse(`query { eligibleShippingMethods { id } }`),
    setShippingMethod: parse(
        `mutation($id: [ID!]!) { setOrderShippingMethod(shippingMethodId: $id) { ${RESULT} } }`,
    ),
    transition: parse(
        `mutation($state: String!) { transitionOrderToState(state: $state) {
            ... on Order { id state }
            ... on OrderStateTransitionError { errorCode message transitionError }
        } }`,
    ),
    addPayment: parse(
        `mutation { addPaymentToOrder(input: { method: "load-payment-method", metadata: {} }) { ... on Order { id state } ... on ErrorResult { errorCode message } } }`,
    ),
    login: parse(
        `mutation($u: String!, $p: String!) { login(username: $u, password: $p) { ... on CurrentUser { id } ... on ErrorResult { errorCode message } } }`,
    ),
    // admin
    variants: parse(`query { productVariants(options: { take: 30, sort: { id: ASC } }) { items { id } } }`),
    variantStock: parse(`query($id: ID!) { productVariant(id: $id) { id stockOnHand stockAllocated } }`),
    updateVariants: parse(
        `mutation($input: [UpdateProductVariantInput!]!) { updateProductVariants(input: $input) { id } }`,
    ),
    orderCount: parse(`query { orders(options: { take: 1 }) { totalItems } }`),
    adminOrder: parse(
        `query($id: ID!) { order(id: $id) { id state active payments { id state amount } history(options: { take: 100 }) { items { type data } } } }`,
    ),
    manualPayment: parse(
        `mutation($input: ManualPaymentInput!) { addManualPaymentToOrder(input: $input) { ... on Order { id state } ... on ErrorResult { errorCode message } } }`,
    ),
    customers: parse(
        `query { customers(options: { take: 10, sort: { id: ASC } }) { items { id emailAddress } } }`,
    ),
};

const address = (street: string) => ({
    fullName: 'Load Customer',
    streetLine1: street,
    city: 'foo',
    postalCode: '123456',
    countryCode: 'US',
});

// ---------------------------------------------------------------- metrics

type Trial = { ok: boolean; anomalies: string[]; errors: string[]; ms: number; extra?: any };
const latencies: Record<string, number[]> = {};
const results: Record<string, { trials: Trial[]; notes?: string }> = {};

function pct(xs: number[], p: number) {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function timed<T>(op: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
        return await fn();
    } finally {
        (latencies[op] ??= []).push(performance.now() - t0);
    }
}

/** Runs a request and records an error instead of throwing. */
async function attempt<T>(op: string, errors: string[], fn: () => Promise<T>): Promise<T | undefined> {
    try {
        const r: any = await timed(op, fn);
        const payload: any = r && Object.values(r)[0];
        if (payload?.errorCode) {
            errors.push(`${op}: ${String(payload.errorCode)}`);
        }
        return r;
    } catch (e: any) {
        errors.push(`${op}: ${classify(e.message ?? String(e))}`);
        return undefined;
    }
}

// ---------------------------------------------------------------- suite

describe(`Order concurrency load [${VARIANT} / ${DB}]`, () => {
    const baseConfig = testConfig();
    const port = +(process.env.BENCH_PORT ?? baseConfig.apiOptions.port);
    const config = mergeConfig(baseConfig, {
        apiOptions: { port },
        logger: new CapturingLogger(),
        paymentOptions: { paymentMethodHandlers: [slowPaymentMethod] },
    });
    const { server, adminClient } = createTestEnvironment(config);
    let V: string[] = [];
    let customerEmails: string[] = [];
    let seq = 0;

    async function newClient(): Promise<SimpleGraphQLClient> {
        const client = new SimpleGraphQLClient(
            config,
            `http://localhost:${port}/${String(config.apiOptions.shopApiPath)}`,
        );
        await client.asAnonymousUser();
        await client.query(D.activeOrder);
        return client;
    }

    async function activeOrder(client: SimpleGraphQLClient) {
        return (await client.query(D.activeOrder)).activeOrder;
    }

    async function toArrangingPayment(client: SimpleGraphQLClient, variants: string[], email?: string) {
        for (const v of variants) {
            await client.query(D.addItem, { v, q: 1 });
        }
        await client.query(D.setCustomer, {
            input: {
                emailAddress: email ?? `load-${seq++}-${Date.now()}@test.com`,
                firstName: 'L',
                lastName: 'C',
            },
        });
        await client.query(D.setShipping, { input: address('1 ship st') });
        const { eligibleShippingMethods } = await client.query(D.eligibleShipping);
        await client.query(D.setShippingMethod, { id: [eligibleShippingMethods[0].id] });
        const r = await client.query(D.transition, { state: 'ArrangingPayment' });
        if (r.transitionOrderToState?.state !== 'ArrangingPayment') {
            throw new Error('could not reach ArrangingPayment: ' + JSON.stringify(r));
        }
        return (await activeOrder(client))!;
    }

    function subtotalConsistent(order: any): boolean {
        const sum = order.lines.reduce((s: number, l: any) => s + l.linePrice, 0);
        return sum === order.subTotal;
    }

    async function trackStock(variantIds: string[], onHand: number) {
        await adminClient.query(D.updateVariants, {
            input: variantIds.map(id => ({
                id,
                trackInventory: 'TRUE',
                stockOnHand: onHand,
                outOfStockThreshold: 0,
                useGlobalOutOfStockThreshold: false,
            })),
        });
    }

    async function runTrials(name: string, n: number, fn: (i: number) => Promise<Trial>) {
        if (!SCENARIOS.includes(name)) return;
        const trials: Trial[] = [];
        for (let i = 0; i < n; i++) {
            const errBefore = serverErrors.length;
            const t0 = performance.now();
            let trial: Trial;
            try {
                trial = await fn(i);
            } catch (e: any) {
                trial = {
                    ok: false,
                    anomalies: ['harness: ' + String(e.message).slice(0, 200)],
                    errors: [],
                    ms: 0,
                };
            }
            trial.ms = performance.now() - t0;
            const newServerErrors = serverErrors.slice(errBefore).map(e => 'server: ' + classify(e.message));
            trial.errors.push(...newServerErrors);
            trials.push(trial);
        }
        results[name] = { trials };
        const bad = trials.filter(t => !t.ok).length;
        console.log(`[${VARIANT}/${DB}] ${name}: ${bad}/${trials.length} anomalous`);
    }

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: slowPaymentMethod.code,
                        handler: { code: slowPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 6,
        });
        await adminClient.asSuperAdmin();
        V = (await adminClient.query(D.variants)).productVariants.items.map((v: any) => v.id);
        customerEmails = (await adminClient.query(D.customers)).customers.items.map(
            (c: any) => c.emailAddress,
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        const summary: Record<string, any> = {};
        for (const [name, r] of Object.entries(results)) {
            const errorCounts: Record<string, number> = {};
            const anomalyCounts: Record<string, number> = {};
            for (const t of r.trials) {
                for (const e of t.errors) errorCounts[e] = (errorCounts[e] ?? 0) + 1;
                for (const a of t.anomalies) anomalyCounts[a] = (anomalyCounts[a] ?? 0) + 1;
            }
            summary[name] = {
                trials: r.trials.length,
                anomalous: r.trials.filter(t => !t.ok).length,
                anomalyCounts,
                errorCounts,
                p50ms: Math.round(
                    pct(
                        r.trials.map(t => t.ms),
                        50,
                    ),
                ),
                p95ms: Math.round(
                    pct(
                        r.trials.map(t => t.ms),
                        95,
                    ),
                ),
                extras: r.trials.map(t => t.extra).filter(Boolean),
            };
        }
        const lat: Record<string, any> = {};
        for (const [op, xs] of Object.entries(latencies)) {
            lat[op] = {
                n: xs.length,
                p50: Math.round(pct(xs, 50)),
                p95: Math.round(pct(xs, 95)),
                p99: Math.round(pct(xs, 99)),
                max: Math.round(Math.max(...xs)),
            };
        }
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(
            OUT,
            JSON.stringify(
                {
                    variant: VARIANT,
                    db: DB,
                    trialsPerScenario: TRIALS,
                    paymentDelayMs: PAYMENT_DELAY_MS,
                    summary,
                    latencies: lat,
                },
                null,
                2,
            ),
        );
        console.log('wrote', OUT);
        await server.destroy();
    });

    // ------------------------------------------------------------ C1 parallel cart mutations

    // #3398 / #2187: K concurrent addItemToOrder on an order that already exists.
    it('fanoutExisting', async () => {
        await runTrials('fanoutExisting', TRIALS, async () => {
            const errors: string[] = [];
            const client = await newClient();
            await client.query(D.addItem, { v: V[0], q: 1 });
            const add = V.slice(1, 6);
            await Promise.all(
                add.map(v => attempt('addItem', errors, () => client.query(D.addItem, { v, q: 1 }))),
            );
            const o = await activeOrder(client);
            const anomalies: string[] = [];
            if (o.lines.length !== add.length + 1) anomalies.push('missing lines');
            if (!subtotalConsistent(o)) anomalies.push('subTotal != sum(lines)');
            if (o.totalQuantity !== o.lines.reduce((s: number, l: any) => s + l.quantity, 0))
                anomalies.push('totalQuantity stale');
            return { ok: anomalies.length === 0 && errors.length === 0, anomalies, errors, ms: 0 };
        });
    }, 600_000);

    // #4152: K concurrent first requests on a fresh session.
    it('fanoutFresh', async () => {
        await runTrials('fanoutFresh', TRIALS, async () => {
            const errors: string[] = [];
            const client = await newClient();
            const before = (await adminClient.query(D.orderCount)).orders.totalItems;
            const add = V.slice(0, 5);
            await Promise.all(
                add.map(v => attempt('addItem', errors, () => client.query(D.addItem, { v, q: 1 }))),
            );
            const after = (await adminClient.query(D.orderCount)).orders.totalItems;
            const o = await activeOrder(client);
            const anomalies: string[] = [];
            if (after - before !== 1) anomalies.push(`orders created: ${after - before}`);
            if (!o || o.lines.length !== add.length) anomalies.push('missing lines');
            else if (!subtotalConsistent(o)) anomalies.push('subTotal != sum(lines)');
            return { ok: anomalies.length === 0 && errors.length === 0, anomalies, errors, ms: 0 };
        });
    }, 600_000);

    // #3398: different setters at once.
    it('mixedSetters', async () => {
        await runTrials('mixedSetters', TRIALS, async i => {
            const errors: string[] = [];
            const client = await newClient();
            await client.query(D.addItem, { v: V[0], q: 1 });
            const { eligibleShippingMethods } = await client.query(D.eligibleShipping);
            const email = `mixed-${i}-${Date.now()}@test.com`;
            await Promise.all([
                attempt('setCustomer', errors, () =>
                    client.query(D.setCustomer, {
                        input: { emailAddress: email, firstName: 'M', lastName: 'S' },
                    }),
                ),
                attempt('setShipping', errors, () => client.query(D.setShipping, { input: address('ship') })),
                attempt('setBilling', errors, () => client.query(D.setBilling, { input: address('bill') })),
                attempt('setShippingMethod', errors, () =>
                    client.query(D.setShippingMethod, { id: [eligibleShippingMethods[0].id] }),
                ),
                attempt('addItem', errors, () => client.query(D.addItem, { v: V[1], q: 2 })),
            ]);
            const o = await activeOrder(client);
            const anomalies: string[] = [];
            if (o.customer?.emailAddress !== email) anomalies.push('customer lost');
            if (o.shippingAddress?.streetLine1 !== 'ship') anomalies.push('shipping address lost');
            if (o.billingAddress?.streetLine1 !== 'bill') anomalies.push('billing address lost');
            if (o.shippingLines.length !== 1) anomalies.push('shipping line lost');
            if (o.lines.length !== 2) anomalies.push('line lost');
            if (!subtotalConsistent(o)) anomalies.push('subTotal != sum(lines)');
            const shippingSum = o.shippingLines.reduce((s: number, l: any) => s + l.priceWithTax, 0);
            if (o.totalWithTax !== o.subTotalWithTax + shippingSum)
                anomalies.push('total != subTotal + shipping');
            return { ok: anomalies.length === 0 && errors.length === 0, anomalies, errors, ms: 0 };
        });
    }, 600_000);

    // ------------------------------------------------------------ C2 limited stock

    // community-plugins#11: M customers pay concurrently for the last unit.
    it('lastUnit', async () => {
        const M = 4;
        await runTrials('lastUnit', Math.max(5, Math.round(TRIALS / 2)), async () => {
            const errors: string[] = [];
            const variant = V[10];
            const { productVariant: before } = await adminClient.query(D.variantStock, { id: variant });
            await trackStock([variant], before.stockAllocated + 1); // exactly one saleable unit
            const clients = await Promise.all(Array.from({ length: M }, () => newClient()));
            for (const c of clients) {
                await toArrangingPayment(c, [variant]);
            }
            const outcomes = await Promise.all(
                clients.map(c => attempt('addPayment', errors, () => c.query(D.addPayment))),
            );
            const placed = outcomes.filter(r => r?.addPaymentToOrder?.state === 'PaymentSettled').length;
            const { productVariant: after } = await adminClient.query(D.variantStock, { id: variant });
            const allocatedDelta = after.stockAllocated - before.stockAllocated;
            const anomalies: string[] = [];
            if (placed > 1) anomalies.push(`oversold: ${placed} orders placed for 1 unit`);
            if (allocatedDelta !== placed)
                anomalies.push(`allocation drift: placed ${placed}, allocated ${allocatedDelta}`);
            if (placed === 0) anomalies.push('nobody got the unit');
            // ErrorResults for the losers are expected, only DB errors count as errors here.
            const dbErrors = errors.filter(e => !/: [A-Z_]+_ERROR$/.test(e));
            return {
                ok: anomalies.length === 0 && dbErrors.length === 0,
                anomalies,
                errors: dbErrors,
                ms: 0,
                extra: { placed },
            };
        });
    }, 900_000);

    // ------------------------------------------------------------ C3 payment webhooks

    // Client and PSP webhook both try to add the payment (modelled with the shop mutation and the
    // admin addManualPaymentToOrder, which is how plugins record a webhook-confirmed payment).
    it('doublePayment', async () => {
        await runTrials('doublePayment', TRIALS, async () => {
            const errors: string[] = [];
            const client = await newClient();
            const order = await toArrangingPayment(client, [V[2]]);
            await Promise.all([
                attempt('addPayment', errors, () => client.query(D.addPayment)),
                attempt('manualPayment', errors, () =>
                    adminClient.query(D.manualPayment, {
                        input: {
                            orderId: order.id,
                            method: 'webhook',
                            transactionId: 'wh-' + order.code,
                            metadata: {},
                        },
                    }),
                ),
            ]);
            const { order: o } = await adminClient.query(D.adminOrder, { id: order.id });
            const settled = o.payments.filter((p: any) => p.state === 'Settled');
            const settledTransitions = o.history.items.filter(
                (h: any) => h.type === 'ORDER_STATE_TRANSITION' && h.data.to === 'PaymentSettled',
            ).length;
            const anomalies: string[] = [];
            if (settled.length > 1) anomalies.push(`charged ${settled.length} times`);
            if (settledTransitions > 1) anomalies.push(`PaymentSettled entered ${settledTransitions} times`);
            if (o.state !== 'PaymentSettled') anomalies.push(`final state ${o.state as string}`);
            const dbErrors = errors.filter(e => !/: [A-Z_]+_ERROR$/.test(e));
            return {
                ok: anomalies.length === 0 && dbErrors.length === 0,
                anomalies,
                errors: dbErrors,
                ms: 0,
            };
        });
    }, 900_000);

    // #3398 (monrostar): webhook settles the payment while the client sends the order back to AddingItems.
    it('payVsBackToCart', async () => {
        await runTrials('payVsBackToCart', TRIALS, async () => {
            const errors: string[] = [];
            const client = await newClient();
            const order = await toArrangingPayment(client, [V[3]]);
            await Promise.all([
                attempt('manualPayment', errors, () =>
                    adminClient.query(D.manualPayment, {
                        input: {
                            orderId: order.id,
                            method: 'webhook',
                            transactionId: 'wh-' + order.code,
                            metadata: {},
                        },
                    }),
                ),
                attempt('transitionBack', errors, () => client.query(D.transition, { state: 'AddingItems' })),
            ]);
            const { order: o } = await adminClient.query(D.adminOrder, { id: order.id });
            const settled = o.payments.filter((p: any) => p.state === 'Settled').length;
            const anomalies: string[] = [];
            if (settled > 0 && o.state === 'AddingItems') anomalies.push('paid but back in AddingItems');
            if (settled > 0 && o.active) anomalies.push('paid but still active');
            if (settled === 0 && o.state === 'PaymentSettled')
                anomalies.push('PaymentSettled without payment');
            const dbErrors = errors.filter(e => !/: [A-Z_]+_ERROR$/.test(e));
            return {
                ok: anomalies.length === 0 && dbErrors.length === 0,
                anomalies,
                errors: dbErrors,
                ms: 0,
                extra: { state: o.state, settled },
            };
        });
    }, 900_000);

    // ------------------------------------------------------------ deadlock surface

    // Two orders with the same tracked variants in opposite line order, paid concurrently,
    // while each customer also mutates their cart-adjacent data.
    it('overlappingAllocations', async () => {
        await runTrials('overlappingAllocations', TRIALS, async () => {
            const errors: string[] = [];
            const vs = [V[12], V[13], V[14]];
            await trackStock(vs, 1000);
            const a = await newClient();
            const b = await newClient();
            await toArrangingPayment(a, vs);
            await toArrangingPayment(b, [...vs].reverse());
            const r = await Promise.all([
                attempt('addPayment', errors, () => a.query(D.addPayment)),
                attempt('addPayment', errors, () => b.query(D.addPayment)),
            ]);
            const placed = r.filter(x => x?.addPaymentToOrder?.state === 'PaymentSettled').length;
            const anomalies: string[] = [];
            if (placed !== 2) anomalies.push(`placed ${placed}/2`);
            return { ok: anomalies.length === 0 && errors.length === 0, anomalies, errors, ms: 0 };
        });
    }, 900_000);

    // A guest with a cart logs in (merging into the customer's existing active order) while the
    // guest cart is still being mutated.
    it('loginDuringCartMutation', async () => {
        await runTrials('loginDuringCartMutation', Math.min(TRIALS, customerEmails.length * 3), async i => {
            const errors: string[] = [];
            const email = customerEmails[i % customerEmails.length];
            // ensure the customer has an existing active order
            const owner = await newClient();
            await owner.query(D.login, { u: email, p: 'test' });
            await owner.query(D.addItem, { v: V[5], q: 1 });
            const guest = await newClient();
            await guest.query(D.addItem, { v: V[6], q: 1 });
            await Promise.all([
                attempt('addItem', errors, () => guest.query(D.addItem, { v: V[7], q: 1 })),
                attempt('login', errors, () => guest.query(D.login, { u: email, p: 'test' })),
                attempt('addItem', errors, () => guest.query(D.addItem, { v: V[8], q: 1 })),
            ]);
            const o = await activeOrder(guest);
            const anomalies: string[] = [];
            if (!o) anomalies.push('no active order after login');
            else if (!subtotalConsistent(o)) anomalies.push('subTotal != sum(lines)');
            return {
                ok: anomalies.length === 0 && errors.length === 0,
                anomalies,
                errors,
                ms: 0,
                extra: { lines: o?.lines.length },
            };
        });
    }, 900_000);

    // Double-submitted checkout: setCustomerForOrder writes Customer then locks the Order, while
    // addPaymentToOrder locks the Order then writes Customer (addresses for a new customer).
    it('setCustomerVsPay', async () => {
        await runTrials('setCustomerVsPay', TRIALS, async i => {
            const errors: string[] = [];
            const client = await newClient();
            const email = `scvp-${i}-${Date.now()}@test.com`;
            const order = await toArrangingPayment(client, [V[4]], email);
            const r = await Promise.all([
                attempt('setCustomer', errors, () =>
                    client.query(D.setCustomer, {
                        input: { emailAddress: email, firstName: 'X', lastName: 'Y' },
                    }),
                ),
                attempt('addPayment', errors, () => client.query(D.addPayment)),
            ]);
            const { order: o } = await adminClient.query(D.adminOrder, { id: order.id });
            const anomalies: string[] = [];
            if (o.state !== 'PaymentSettled') anomalies.push(`final state ${o.state as string}`);
            const dbErrors = errors.filter(e => !/: [A-Z_]+_ERROR$/.test(e));
            return {
                ok: anomalies.length === 0 && dbErrors.length === 0,
                anomalies,
                errors: dbErrors,
                ms: 0,
            };
        });
    }, 900_000);

    // ------------------------------------------------------------ throughput

    // P independent customers check out concurrently: no shared order, so this measures the
    // fixed cost of the locks rather than contention.
    it('throughput', async () => {
        if (!SCENARIOS.includes('throughput')) return;
        const P = +(process.env.BENCH_P ?? 20);
        const rounds = +(process.env.BENCH_ROUNDS ?? 3);
        const variant = V[20];
        await trackStock([variant], 1_000_000);
        const trials: Trial[] = [];
        for (let r = 0; r < rounds; r++) {
            const clients = await Promise.all(Array.from({ length: P }, () => newClient()));
            const errors: string[] = [];
            const t0 = performance.now();
            await Promise.all(
                clients.map(async c => {
                    try {
                        await timed('tp:addItem', () => c.query(D.addItem, { v: variant, q: 1 }));
                        await timed('tp:addItem', () => c.query(D.addItem, { v: V[21], q: 1 }));
                        await timed('tp:setCustomer', () =>
                            c.query(D.setCustomer, {
                                input: {
                                    emailAddress: `tp-${seq++}@test.com`,
                                    firstName: 'T',
                                    lastName: 'P',
                                },
                            }),
                        );
                        await timed('tp:setShipping', () => c.query(D.setShipping, { input: address('tp') }));
                        const { eligibleShippingMethods } = await timed('tp:eligibleShipping', () =>
                            c.query(D.eligibleShipping),
                        );
                        await timed('tp:setShippingMethod', () =>
                            c.query(D.setShippingMethod, { id: [eligibleShippingMethods[0].id] }),
                        );
                        await timed('tp:activeOrder', () => c.query(D.activeOrder));
                        await timed('tp:transition', () =>
                            c.query(D.transition, { state: 'ArrangingPayment' }),
                        );
                        await timed('tp:addPayment', () => c.query(D.addPayment));
                    } catch (e: any) {
                        errors.push(classify(e.message));
                    }
                }),
            );
            const ms = performance.now() - t0;
            trials.push({
                ok: errors.length === 0,
                anomalies: [],
                errors,
                ms,
                extra: { checkoutsPerSec: (P / ms) * 1000 },
            });
        }
        results.throughput = { trials };
    }, 900_000);

    // K orders at ArrangingPayment each receive R concurrent payment attempts (double clicks,
    // webhook redeliveries) while the payment provider is slow (BENCH_PAYMENT_DELAY_MS), and B
    // bystanders shop normally. Measures how long the queued attempts hold pool connections, and
    // what that does to everybody else.
    it('paymentPileUp', async () => {
        if (!SCENARIOS.includes('paymentPileUp')) return;
        const K = +(process.env.BENCH_K ?? 3);
        const R = +(process.env.BENCH_R ?? 6);
        const B = +(process.env.BENCH_B ?? 10);
        const rounds = +(process.env.BENCH_ROUNDS ?? 3);
        const trials: Trial[] = [];
        for (let r = 0; r < rounds; r++) {
            const payers = await Promise.all(Array.from({ length: K }, () => newClient()));
            const orders = [];
            for (const c of payers) {
                orders.push(await toArrangingPayment(c, [V[2]]));
            }
            const bystanders = await Promise.all(Array.from({ length: B }, () => newClient()));
            const errors: string[] = [];
            const t0 = performance.now();
            await Promise.all([
                ...payers.flatMap(c =>
                    Array.from({ length: R }, () =>
                        attempt('pileUp:addPayment', errors, () => c.query(D.addPayment)),
                    ),
                ),
                ...bystanders.map(async c => {
                    for (let k = 0; k < 5; k++) {
                        await attempt('pileUp:bystanderAddItem', errors, () =>
                            c.query(D.addItem, { v: V[16 + k], q: 1 }),
                        );
                    }
                }),
            ]);
            const anomalies: string[] = [];
            for (const order of orders) {
                const { order: o } = await adminClient.query(D.adminOrder, { id: order.id });
                const settled = o.payments.filter((p: any) => p.state === 'Settled').length;
                if (settled !== 1) anomalies.push(`order paid ${settled as number} times`);
            }
            const dbErrors = errors.filter(e => !/: [A-Z_]+_ERROR$/.test(e));
            trials.push({
                ok: anomalies.length === 0 && dbErrors.length === 0,
                anomalies,
                errors: dbErrors,
                ms: performance.now() - t0,
            });
        }
        results.paymentPileUp = { trials };
    }, 900_000);

    // One cart receives H concurrent mutations while B bystanders shop normally. Measures
    // head-of-line blocking: requests waiting on the order lock hold a pool connection.
    it('hotCart', async () => {
        if (!SCENARIOS.includes('hotCart')) return;
        const H = +(process.env.BENCH_H ?? 30);
        const B = +(process.env.BENCH_B ?? 10);
        const rounds = +(process.env.BENCH_ROUNDS ?? 3);
        const trials: Trial[] = [];
        for (let r = 0; r < rounds; r++) {
            const hot = await newClient();
            await hot.query(D.addItem, { v: V[0], q: 1 });
            const bystanders = await Promise.all(Array.from({ length: B }, () => newClient()));
            const errors: string[] = [];
            const t0 = performance.now();
            await Promise.all([
                ...Array.from({ length: H }, (_, k) =>
                    attempt('hot:addItem', errors, () => hot.query(D.addItem, { v: V[1 + (k % 15)], q: 1 })),
                ),
                ...bystanders.map(async c => {
                    for (let k = 0; k < 5; k++) {
                        await attempt('bystander:addItem', errors, () =>
                            c.query(D.addItem, { v: V[16 + k], q: 1 }),
                        );
                    }
                }),
            ]);
            const o = await activeOrder(hot);
            const anomalies: string[] = [];
            const qty = o.lines.reduce((s: number, l: any) => s + l.quantity, 0);
            if (qty !== H + 1) anomalies.push(`hot cart quantity ${qty as number} != ${H + 1}`);
            if (!subtotalConsistent(o)) anomalies.push('subTotal != sum(lines)');
            trials.push({
                ok: anomalies.length === 0 && errors.length === 0,
                anomalies,
                errors,
                ms: performance.now() - t0,
            });
        }
        results.hotCart = { trials };
    }, 900_000);
});
