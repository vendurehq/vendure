/* eslint-disable no-console */
// OSS-999 spike prototype. A one-time helper for installs that opt into a non-global
// IdentityScopeStrategy. Installs that keep the default GlobalIdentityScopeStrategy do not need
// it: the generated migration adds `customer.identityScope` with the default 'global'.
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

/**
 * @description
 * The Channel columns passed to the `getIdentityScope` callback of
 * {@link migrateCustomerIdentityScopes}. Use the same logic as your {@link IdentityScopeStrategy}.
 */
export interface IdentityScopeMigrationChannel {
    id: number | string;
    code: string;
    token: string;
}

export interface CustomerIdentityScopeMigrationResult {
    /** Customers whose channels are all in one scope, which were given that scope. */
    assigned: number;
    /** Customers whose channels span several scopes, which were split into one per scope. */
    split: number;
    /** Copies created by splitting. */
    copiesCreated: number;
}

/**
 * @description
 * Moves existing Customers into the identity scopes of a non-global {@link IdentityScopeStrategy}.
 *
 * Before v4 a Customer is shared by every Channel it has joined. For each Customer this helper
 * works out the scopes of its Channels. The default Channel is ignored unless it is the only
 * Channel, because pre-v4 versions joined every Customer to it.
 *
 * - **One scope**: the Customer is given that scope. No other data changes.
 * - **Several scopes**: the Customer is split. The original keeps the scope that holds most of
 *   its Orders (ties go to the lowest Channel id). For each other scope a copy is created, with a
 *   copy of the User and its authentication methods (so the same password and external logins
 *   keep working there), the Addresses and the CustomerGroup memberships. The Channel memberships
 *   and Orders of that scope move to the copy. History entries stay on the original.
 *
 * Run it in a migration after the `customer.identityScope` column has been created, with the
 * same scope logic as the strategy you configure. It is idempotent only for unsplit Customers,
 * so run it once.
 */
export async function migrateCustomerIdentityScopes(
    queryRunner: QueryRunner,
    getIdentityScope: (channel: IdentityScopeMigrationChannel) => string,
): Promise<CustomerIdentityScopeMigrationResult> {
    const prefix = queryRunner.connection.options.entityPrefix ?? '';
    const t = (name: string) => queryRunner.connection.driver.escape(`${prefix}${name}`);
    const c = (name: string) => queryRunner.connection.driver.escape(name);
    const p = (i: number) => (queryRunner.connection.driver.options.type === 'postgres' ? `$${i}` : '?');

    const channels: IdentityScopeMigrationChannel[] = await queryRunner.query(
        `SELECT ${c('id')}, ${c('code')}, ${c('token')} FROM ${t('channel')}`,
    );
    const channelById = new Map(channels.map(ch => [String(ch.id), ch]));
    const defaultChannel = channels.find(ch => ch.code === DEFAULT_CHANNEL_CODE);
    const scopeOf = (channelId: string) => getIdentityScope(channelById.get(channelId)!);

    const memberships: Array<{ customerId: any; channelId: any }> = await queryRunner.query(
        `SELECT ${c('customerId')}, ${c('channelId')} FROM ${t('customer_channels_channel')}`,
    );
    const channelsByCustomer = new Map<string, string[]>();
    for (const m of memberships) {
        const list = channelsByCustomer.get(String(m.customerId)) ?? [];
        list.push(String(m.channelId));
        channelsByCustomer.set(String(m.customerId), list);
    }

    const result: CustomerIdentityScopeMigrationResult = { assigned: 0, split: 0, copiesCreated: 0 };
    for (const [customerId, channelIds] of channelsByCustomer) {
        const nonDefault = channelIds.filter(id => id !== String(defaultChannel?.id));
        const relevant = nonDefault.length ? nonDefault : channelIds;
        const scopes = [...new Set(relevant.map(scopeOf))];
        if (scopes.length === 1) {
            await queryRunner.query(
                `UPDATE ${t('customer')} SET ${c('identityScope')} = ${p(1)} WHERE ${c('id')} = ${p(2)}`,
                [scopes[0], customerId],
            );
            result.assigned++;
            continue;
        }

        // Orders per scope, to choose the scope the original Customer keeps.
        const orders: Array<{ id: any; channelId: any }> = await queryRunner.query(
            `SELECT o.${c('id')}, oc.${c('channelId')} FROM ${t('order')} o
             INNER JOIN ${t('order_channels_channel')} oc ON oc.${c('orderId')} = o.${c('id')}
             WHERE o.${c('customerId')} = ${p(1)}`,
            [customerId],
        );
        const orderScope = new Map<string, string>();
        for (const o of orders) {
            if (String(o.channelId) !== String(defaultChannel?.id) || !orderScope.has(String(o.id))) {
                orderScope.set(String(o.id), scopeOf(String(o.channelId)));
            }
        }
        const lowestChannelOf = (scope: string) =>
            Math.min(...relevant.filter(id => scopeOf(id) === scope).map(Number));
        const primary = [...scopes].sort((a, b) => {
            const count = (s: string) => [...orderScope.values()].filter(v => v === s).length;
            return count(b) - count(a) || lowestChannelOf(a) - lowestChannelOf(b);
        })[0];

        await queryRunner.query(
            `UPDATE ${t('customer')} SET ${c('identityScope')} = ${p(1)} WHERE ${c('id')} = ${p(2)}`,
            [primary, customerId],
        );
        for (const scope of scopes.filter(s => s !== primary)) {
            const copyId = await copyCustomer(queryRunner, customerId, scope, t, c, p);
            const scopeChannelIds = relevant.filter(id => scopeOf(id) === scope);
            for (const channelId of scopeChannelIds) {
                await queryRunner.query(
                    `UPDATE ${t('customer_channels_channel')} SET ${c('customerId')} = ${p(1)}
                     WHERE ${c('customerId')} = ${p(2)} AND ${c('channelId')} = ${p(3)}`,
                    [copyId, customerId, channelId],
                );
            }
            if (defaultChannel) {
                // Every Customer stays visible on the default Channel in the Admin API.
                await queryRunner.query(
                    `INSERT INTO ${t('customer_channels_channel')} (${c('customerId')}, ${c('channelId')})
                     VALUES (${p(1)}, ${p(2)})`,
                    [copyId, defaultChannel.id],
                );
            }
            for (const [orderId, s] of orderScope) {
                if (s === scope) {
                    await queryRunner.query(
                        `UPDATE ${t('order')} SET ${c('customerId')} = ${p(1)} WHERE ${c('id')} = ${p(2)}`,
                        [copyId, orderId],
                    );
                }
            }
            result.copiesCreated++;
        }
        result.split++;
    }
    console.log(
        `Customer identity scopes: ${result.assigned} assigned, ${result.split} split into ` +
            `${result.copiesCreated} additional Customers`,
    );
    return result;
}

async function copyCustomer(
    queryRunner: QueryRunner,
    customerId: string,
    scope: string,
    t: (name: string) => string,
    c: (name: string) => string,
    p: (i: number) => string,
): Promise<string> {
    const [customer] = await queryRunner.query(`SELECT * FROM ${t('customer')} WHERE ${c('id')} = ${p(1)}`, [
        customerId,
    ]);
    let newUserId: string | null = null;
    if (customer.userId != null) {
        newUserId = await copyRow(queryRunner, 'user', customer.userId, {}, t, c, p);
        const methods: Array<{ id: any }> = await queryRunner.query(
            `SELECT ${c('id')} FROM ${t('authentication_method')} WHERE ${c('userId')} = ${p(1)}`,
            [customer.userId],
        );
        for (const m of methods) {
            await copyRow(queryRunner, 'authentication_method', m.id, { userId: newUserId }, t, c, p);
        }
    }
    const copyId = await copyRow(
        queryRunner,
        'customer',
        customerId,
        { identityScope: scope, userId: newUserId },
        t,
        c,
        p,
    );
    const addresses: Array<{ id: any }> = await queryRunner.query(
        `SELECT ${c('id')} FROM ${t('address')} WHERE ${c('customerId')} = ${p(1)}`,
        [customerId],
    );
    for (const a of addresses) {
        await copyRow(queryRunner, 'address', a.id, { customerId: copyId }, t, c, p);
    }
    const groups: Array<{ customerGroupId: any }> = await queryRunner.query(
        `SELECT ${c('customerGroupId')} FROM ${t('customer_groups_customer_group')} WHERE ${c('customerId')} = ${p(1)}`,
        [customerId],
    );
    for (const g of groups) {
        await queryRunner.query(
            `INSERT INTO ${t('customer_groups_customer_group')} (${c('customerId')}, ${c('customerGroupId')})
             VALUES (${p(1)}, ${p(2)})`,
            [copyId, g.customerGroupId],
        );
    }
    return copyId;
}

/**
 * Copies one row, leaving out its id so the database assigns a new one, and returns the new id.
 * Assumes numeric auto-increment ids (the default); UUID installs would generate the id here.
 */
async function copyRow(
    queryRunner: QueryRunner,
    table: string,
    id: any,
    overrides: Record<string, any>,
    t: (name: string) => string,
    c: (name: string) => string,
    p: (i: number) => string,
): Promise<string> {
    const [row] = await queryRunner.query(`SELECT * FROM ${t(table)} WHERE ${c('id')} = ${p(1)}`, [id]);
    const values = { ...row, ...overrides };
    delete values.id;
    const columns = Object.keys(values);
    const isPostgres = queryRunner.connection.driver.options.type === 'postgres';
    const insert = `INSERT INTO ${t(table)} (${columns.map(c).join(', ')})
        VALUES (${columns.map((_, i) => p(i + 1)).join(', ')})${isPostgres ? ` RETURNING ${c('id')}` : ''}`;
    const params = columns.map(k => values[k]);
    if (isPostgres) {
        const [inserted] = await queryRunner.query(insert, params);
        return String(inserted.id);
    }
    await queryRunner.query(insert, params);
    const [{ id: newId }] = await queryRunner.query(
        `SELECT MAX(${c('id')}) AS ${c('id')} FROM ${t(table)}`,
    );
    return String(newId);
}
