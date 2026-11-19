/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    CachedSession,
    mergeConfig,
    Order,
    RequestContext,
    Session,
    SessionCacheStrategy,
    SessionService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { fail } from 'assert';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { SUPER_ADMIN_USER_IDENTIFIER, SUPER_ADMIN_USER_PASSWORD } from '../../common/src/shared-constants';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { attemptLoginDocument, logoutDocument, MeDocument } from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    addPaymentDocument,
    getActiveOrderDocument,
    setCustomerDocument,
} from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

const testSessionCache = new Map<string, CachedSession>();
const getSpy = vi.fn();
const setSpy = vi.fn();
const clearSpy = vi.fn();
const deleteSpy = vi.fn();

class TestingSessionCacheStrategy implements SessionCacheStrategy {
    clear() {
        clearSpy();
        testSessionCache.clear();
    }

    delete(sessionToken: string) {
        deleteSpy(sessionToken);
        testSessionCache.delete(sessionToken);
    }

    get(sessionToken: string) {
        getSpy(sessionToken);
        return testSessionCache.get(sessionToken);
    }

    set(session: CachedSession) {
        setSpy(session);
        testSessionCache.set(session.token, session);
    }
}

describe('Session caching', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                sessionCacheStrategy: new TestingSessionCacheStrategy(),
                sessionCacheTTL: 2,
            },
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        testSessionCache.clear();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('populates the cache on login', async () => {
        setSpy.mockClear();
        expect(setSpy.mock.calls.length).toBe(0);
        expect(testSessionCache.size).toBe(0);

        await adminClient.query(attemptLoginDocument, {
            username: SUPER_ADMIN_USER_IDENTIFIER,
            password: SUPER_ADMIN_USER_PASSWORD,
        });

        expect(testSessionCache.size).toBe(1);
        expect(setSpy.mock.calls.length).toBe(1);
    });

    it('takes user data from cache on next request', async () => {
        getSpy.mockClear();
        const { me } = await adminClient.query(MeDocument);

        expect(getSpy.mock.calls.length).toBe(1);
    });

    it('sets fresh data after TTL expires', async () => {
        setSpy.mockClear();

        await adminClient.query(MeDocument);
        expect(setSpy.mock.calls.length).toBe(0);

        await adminClient.query(MeDocument);
        expect(setSpy.mock.calls.length).toBe(0);

        await pause(2000);

        await adminClient.query(MeDocument);
        expect(setSpy.mock.calls.length).toBe(1);
    });

    it('clears cache for that user on logout', async () => {
        deleteSpy.mockClear();
        expect(deleteSpy.mock.calls.length).toBe(0);
        await adminClient.query(logoutDocument);

        expect(testSessionCache.size).toBe(0);
        expect(deleteSpy.mock.calls.length).toBeGreaterThan(0);
    });

    // #5625: an active-order change must not outlive the transaction which wrote it.
    describe('active order transactions', () => {
        async function prepareChange(operation: 'set' | 'unset') {
            shopClient.setHeader('Authorization', null);
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            expect(addItemToOrder).toHaveProperty('id');
            const service = server.app.get(SessionService);
            const connection = server.app.get(TransactionalConnection);
            const token = shopClient.getAuthToken();
            const initialSession = (await service.getSessionFromToken(token))!;
            expect(initialSession.activeOrderId).toBeDefined();
            const order = await connection.rawConnection.getRepository(Order).findOneOrFail({
                where: { id: initialSession.activeOrderId! },
            });
            if (operation === 'set') {
                await service.unsetActiveOrder(RequestContext.empty(), initialSession);
            }
            const session = (await service.getSessionFromToken(token))!;
            const change = (ctx: RequestContext) =>
                operation === 'set'
                    ? service.setActiveOrder(ctx, session, order)
                    : service.unsetActiveOrder(ctx, session);
            const readDatabaseSession = () =>
                connection.rawConnection.getRepository(Session).findOneOrFail({ where: { id: session.id } });
            return { service, connection, token, session, order, change, readDatabaseSession };
        }

        it.each(['set', 'unset'] as const)(
            'preserves the committed active order after %s rolls back',
            async operation => {
                const { service, connection, token, session, change, readDatabaseSession } =
                    await prepareChange(operation);

                await expect(
                    connection.withTransaction(async ctx => {
                        await change(ctx);
                        throw new Error('Roll back the active order change');
                    }),
                ).rejects.toThrow('Roll back the active order change');

                expect((await readDatabaseSession()).activeOrderId).toBe(session.activeOrderId);
                expect((await service.getSessionFromToken(token))!.activeOrderId).toBe(session.activeOrderId);
            },
        );

        it.each(['set', 'unset'] as const)(
            'exposes the new active order only after %s commits',
            async operation => {
                const { service, connection, token, session, order, change, readDatabaseSession } =
                    await prepareChange(operation);
                const expectedOrderId = operation === 'set' ? order.id : null;

                const updatedSession = await connection.withTransaction(async ctx => {
                    const updated = await change(ctx);
                    expect(updated.activeOrderId).toBe(expectedOrderId);
                    expect(testSessionCache.get(token)!.activeOrderId).toBe(session.activeOrderId);
                    return updated;
                });

                expect(updatedSession.activeOrderId).toBe(expectedOrderId);
                expect((await readDatabaseSession()).activeOrderId).toBe(expectedOrderId);
                expect((await service.getSessionFromToken(token))!.activeOrderId).toBe(expectedOrderId);
                const { activeOrder } = await shopClient.query(getActiveOrderDocument);
                expect(activeOrder?.id ?? null).toBe(operation === 'set' ? `T_${order.id}` : null);
            },
        );

        it.each(['set', 'unset'] as const)(
            'updates the cache immediately for %s outside a transaction',
            async operation => {
                const { service, token, order, change, readDatabaseSession } = await prepareChange(operation);
                const expectedOrderId = operation === 'set' ? order.id : null;

                await change(RequestContext.empty());

                expect(testSessionCache.get(token)!.activeOrderId).toBe(expectedOrderId);
                expect((await readDatabaseSession()).activeOrderId).toBe(expectedOrderId);
                expect((await service.getSessionFromToken(token))!.activeOrderId).toBe(expectedOrderId);
            },
        );

        it.each(['set', 'unset'] as const)(
            'does not publish %s after a savepoint commits but the outer transaction rolls back',
            async operation => {
                const { service, connection, token, session, change, readDatabaseSession } =
                    await prepareChange(operation);

                await expect(
                    connection.withTransaction(async ctx => {
                        await connection.withTransaction(ctx, change);
                        expect(testSessionCache.get(token)!.activeOrderId).toBe(session.activeOrderId);
                        throw new Error('Roll back the outer transaction');
                    }),
                ).rejects.toThrow('Roll back the outer transaction');

                expect((await readDatabaseSession()).activeOrderId).toBe(session.activeOrderId);
                expect((await service.getSessionFromToken(token))!.activeOrderId).toBe(session.activeOrderId);
            },
        );

        it.each(['set', 'unset'] as const)(
            'reloads committed state when %s rolls back to a savepoint and the outer transaction commits',
            async operation => {
                const { service, connection, token, session, change, readDatabaseSession } =
                    await prepareChange(operation);

                await connection.withTransaction(async ctx => {
                    await expect(
                        connection.withTransaction(ctx, async innerCtx => {
                            await change(innerCtx);
                            throw new Error('Roll back to the savepoint');
                        }),
                    ).rejects.toThrow('Roll back to the savepoint');
                    expect(testSessionCache.get(token)!.activeOrderId).toBe(session.activeOrderId);
                });

                expect(testSessionCache.has(token)).toBe(false);
                expect((await readDatabaseSession()).activeOrderId).toBe(session.activeOrderId);
                expect((await service.getSessionFromToken(token))!.activeOrderId).toBe(session.activeOrderId);
            },
        );

        it('allows a payment retry after the checkout transaction rolls back', async () => {
            const { service, connection, token, session, order, readDatabaseSession } =
                await prepareChange('unset');
            await shopClient.query(setCustomerDocument, {
                input: {
                    firstName: 'Checkout',
                    lastName: 'Retry',
                    emailAddress: 'checkout-retry@example.com',
                },
            });
            const orderId = await proceedToArrangingPayment(shopClient);
            const paymentInput = { method: testSuccessfulPaymentMethod.code, metadata: {} };
            const unsetActiveOrder = service.unsetActiveOrder.bind(service);
            const failure = vi
                .spyOn(service, 'unsetActiveOrder')
                .mockImplementationOnce(async (ctx, cachedSession) => {
                    await unsetActiveOrder(ctx, cachedSession);
                    throw new Error('Fail after clearing the checkout session');
                });
            try {
                await expect(shopClient.query(addPaymentDocument, { input: paymentInput })).rejects.toThrow(
                    'Fail after clearing the checkout session',
                );
                expect(failure).toHaveBeenCalledOnce();
            } finally {
                failure.mockRestore();
            }

            const rolledBackOrder = await connection.rawConnection.getRepository(Order).findOneOrFail({
                where: { id: order.id },
                relations: { payments: true },
            });
            expect(rolledBackOrder.state).toBe('ArrangingPayment');
            expect(rolledBackOrder.active).toBe(true);
            expect(rolledBackOrder.payments).toHaveLength(0);
            expect((await readDatabaseSession()).activeOrderId).toBe(session.activeOrderId);

            const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, { input: paymentInput });
            expect(addPaymentToOrder).toMatchObject({ id: orderId, state: 'PaymentSettled' });
            const paidOrder = await connection.rawConnection.getRepository(Order).findOneOrFail({
                where: { id: order.id },
                relations: { payments: true },
            });
            expect(paidOrder.active).toBe(false);
            expect(paidOrder.payments).toHaveLength(1);
            expect((await readDatabaseSession()).activeOrderId).toBeNull();
            expect((await service.getSessionFromToken(token))!.activeOrderId).toBeNull();
        });
    });
});

describe('Session expiry', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                sessionDuration: '3s',
                sessionCacheTTL: 1,
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('session does not expire with continued use', async () => {
        await adminClient.asSuperAdmin();
        await pause(1000);
        await adminClient.query(MeDocument);
        await pause(1000);
        await adminClient.query(MeDocument);
        await pause(1000);
        await adminClient.query(MeDocument);
        await pause(1000);
        await adminClient.query(MeDocument);
    }, 10000);

    it('session expires when not used for longer than sessionDuration', async () => {
        await adminClient.asSuperAdmin();
        await pause(3500);
        try {
            await adminClient.query(MeDocument);
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('You are not currently authorized to perform this action');
        }
    }, 10000);
});

function pause(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
