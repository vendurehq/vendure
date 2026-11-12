/* eslint-disable no-console */
// OSS-999 spike prototype. A one-time helper for installs that opt into a non-global
// IdentityScopeStrategy. Installs that keep the default GlobalIdentityScopeStrategy do not need
// it: the generated migration adds `customer.identityScope` with the default 'global'.
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

/**
 * @description
 * The Channel passed to the `getIdentityScope` callback of {@link migrateCustomerIdentityScopes}.
 * It carries the columns of the `channel` table, including `sellerId` and the custom field columns
 * (as `customFields.<name>`, or `customFields.<name>Id` for a relation). Use the same logic as your
 * {@link IdentityScopeStrategy}.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export interface IdentityScopeMigrationChannel {
    id: number | string;
    code: string;
    token: string;
    sellerId?: number | string | null;
    customFields: Record<string, any>;
    [column: string]: any;
}

/**
 * @description
 * Options for {@link migrateCustomerIdentityScopes}.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export interface CustomerIdentityScopeMigrationOptions {
    /**
     * @description
     * Pre-v4 versions join every Customer to the default Channel, so that membership does not show
     * whether the Customer used the default Channel as a storefront. When `true`, the default
     * Channel counts as one of the Customer's storefronts if the Customer has an Order placed on the
     * default Channel only. Set it to `false` if the default Channel is not a storefront.
     *
     * @default true
     */
    defaultChannelIsStorefront?: boolean;
}

/**
 * @description
 * The result of {@link migrateCustomerIdentityScopes}.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export interface CustomerIdentityScopeMigrationResult {
    /** Customers whose channels are all in one scope, which were given that scope. */
    assigned: number;
    /** Customers with no Channel membership, which were given the default Channel's scope. */
    withoutChannel: number;
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
 * works out the scopes of the Channels it uses. Pre-v4 versions joined every Customer to the
 * default Channel, so that membership only counts if it is the Customer's only one, or if
 * `defaultChannelIsStorefront` is on and the Customer has an Order placed on the default Channel
 * only.
 *
 * - **One scope**: the Customer is given that scope. No other data changes.
 * - **No Channel**: the Customer is given the default Channel's scope.
 * - **Several scopes**: the Customer is split. The original keeps the scope that holds most of
 *   its Orders (ties go to the lowest Channel id). For each other scope a copy is created, with a
 *   copy of the User and its authentication methods (so the same password and external logins
 *   keep working there), the Addresses and the CustomerGroup memberships. Pending verification,
 *   password reset and email change tokens are not copied: they stay with the original. The Channel
 *   memberships and Orders of that scope move to the copy, and sessions whose active Order moved
 *   lose it. Every copy is also joined to the default Channel, so that it is listed there in the
 *   Admin API. History entries stay on the original.
 *
 * Run it in a migration after the `customer.identityScope` column has been created, with the
 * same scope logic as the strategy you configure, and clear the session cache afterwards. It is
 * idempotent only for unsplit Customers, so run it once.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function migrateCustomerIdentityScopes(
    queryRunner: QueryRunner,
    getIdentityScope: (channel: IdentityScopeMigrationChannel) => string | Promise<string>,
    options: CustomerIdentityScopeMigrationOptions = {},
): Promise<CustomerIdentityScopeMigrationResult> {
    const defaultChannelIsStorefront = options.defaultChannelIsStorefront ?? true;
    const prefix = queryRunner.connection.options.entityPrefix ?? '';
    const t = (name: string) => queryRunner.connection.driver.escape(`${prefix}${name}`);
    const c = (name: string) => queryRunner.connection.driver.escape(name);
    const p = (i: number) => (isPostgresFamily(queryRunner) ? `$${i}` : '?');

    const channelRows: Array<Record<string, any>> = await queryRunner.query(`SELECT * FROM ${t('channel')}`);
    const scopeByChannel = new Map<string, string>();
    for (const row of channelRows) {
        scopeByChannel.set(String(row.id), await getIdentityScope(toMigrationChannel(row)));
    }
    const defaultChannel = channelRows.find(ch => ch.code === DEFAULT_CHANNEL_CODE);
    const defaultChannelId = defaultChannel ? String(defaultChannel.id) : undefined;
    const scopeOf = (channelId: string): string => {
        const scope = scopeByChannel.get(channelId);
        if (scope === undefined) {
            throw new Error(`No Channel with id ${channelId} found`);
        }
        return scope;
    };
    const byChannelId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

    const memberships: Array<{ customerId: any; channelId: any }> = await queryRunner.query(
        `SELECT ${c('customerId')}, ${c('channelId')} FROM ${t('customer_channels_channel')}`,
    );
    const channelsByCustomer = new Map<string, string[]>();
    for (const m of memberships) {
        const list = channelsByCustomer.get(String(m.customerId)) ?? [];
        list.push(String(m.channelId));
        channelsByCustomer.set(String(m.customerId), list);
    }

    const result: CustomerIdentityScopeMigrationResult = {
        assigned: 0,
        withoutChannel: 0,
        split: 0,
        copiesCreated: 0,
    };
    const setScope = (customerId: string, scope: string) =>
        queryRunner.query(
            `UPDATE ${t('customer')} SET ${c('identityScope')} = ${p(1)} WHERE ${c('id')} = ${p(2)}`,
            [scope, customerId],
        );

    if (defaultChannelId) {
        const allCustomers: Array<{ id: any }> = await queryRunner.query(
            `SELECT ${c('id')} FROM ${t('customer')}`,
        );
        for (const { id } of allCustomers) {
            if (!channelsByCustomer.has(String(id))) {
                await setScope(String(id), scopeOf(defaultChannelId));
                result.withoutChannel++;
            }
        }
    }

    for (const [customerId, channelIds] of channelsByCustomer) {
        // The Channels of each of the Customer's Orders. An Order on another Channel is also
        // joined to the default Channel, so an Order joined to the default Channel only was
        // placed there.
        const orderRows: Array<{ id: any; channelId: any }> = await queryRunner.query(
            `SELECT o.${c('id')}, oc.${c('channelId')} FROM ${t('order')} o
             INNER JOIN ${t('order_channels_channel')} oc ON oc.${c('orderId')} = o.${c('id')}
             WHERE o.${c('customerId')} = ${p(1)}`,
            [customerId],
        );
        const orderChannels = new Map<string, string[]>();
        for (const o of orderRows) {
            const list = orderChannels.get(String(o.id)) ?? [];
            list.push(String(o.channelId));
            orderChannels.set(String(o.id), list);
        }
        const orderScope = new Map<string, string>();
        for (const [orderId, ids] of orderChannels) {
            const placedOn = ids.filter(id => id !== defaultChannelId).sort(byChannelId)[0] ?? ids[0];
            orderScope.set(orderId, scopeOf(placedOn));
        }
        const usedDefaultAsStorefront =
            defaultChannelIsStorefront &&
            [...orderChannels.values()].some(ids => ids.every(id => id === defaultChannelId));

        const nonDefault = channelIds.filter(id => id !== defaultChannelId);
        const relevant = channelIds.filter(
            id => id !== defaultChannelId || usedDefaultAsStorefront || nonDefault.length === 0,
        );
        const scopes = [...new Set(relevant.map(scopeOf))];
        if (scopes.length === 1) {
            await setScope(customerId, scopes[0]);
            result.assigned++;
            continue;
        }

        const orderCount = (scope: string) => [...orderScope.values()].filter(v => v === scope).length;
        const lowestChannelOf = (scope: string) =>
            relevant.filter(id => scopeOf(id) === scope).sort(byChannelId)[0];
        const primary = [...scopes].sort(
            (a, b) => orderCount(b) - orderCount(a) || byChannelId(lowestChannelOf(a), lowestChannelOf(b)),
        )[0];

        await setScope(customerId, primary);
        for (const scope of scopes.filter(s => s !== primary)) {
            const copyId = await copyCustomer(queryRunner, customerId, scope, t, c, p);
            // The original keeps its default Channel membership. The copy gets its own below.
            const scopeChannelIds = relevant.filter(id => scopeOf(id) === scope && id !== defaultChannelId);
            for (const channelId of scopeChannelIds) {
                await queryRunner.query(
                    `UPDATE ${t('customer_channels_channel')} SET ${c('customerId')} = ${p(1)}
                     WHERE ${c('customerId')} = ${p(2)} AND ${c('channelId')} = ${p(3)}`,
                    [copyId, customerId, channelId],
                );
            }
            if (defaultChannelId) {
                // Every Customer stays visible on the default Channel in the Admin API.
                await queryRunner.query(
                    `INSERT INTO ${t('customer_channels_channel')} (${c('customerId')}, ${c('channelId')})
                     VALUES (${p(1)}, ${p(2)})`,
                    [copyId, defaultChannelId],
                );
            }
            for (const [orderId, s] of orderScope) {
                if (s !== scope) {
                    continue;
                }
                await queryRunner.query(
                    `UPDATE ${t('order')} SET ${c('customerId')} = ${p(1)} WHERE ${c('id')} = ${p(2)}`,
                    [copyId, orderId],
                );
                // A session of the original User must not keep driving an Order of the copy.
                await queryRunner.query(
                    `UPDATE ${t('session')} SET ${c('activeOrderId')} = NULL WHERE ${c('activeOrderId')} = ${p(1)}`,
                    [orderId],
                );
            }
            result.copiesCreated++;
        }
        result.split++;
    }
    console.log(
        `Customer identity scopes: ${result.assigned} assigned, ${result.withoutChannel} without a Channel ` +
            `given the default Channel's scope, ${result.split} split into ${result.copiesCreated} additional Customers`,
    );
    return result;
}

function isPostgresFamily(queryRunner: QueryRunner) {
    return ['postgres', 'cockroachdb', 'aurora-postgres'].includes(
        queryRunner.connection.driver.options.type,
    );
}

/**
 * Turns a raw `channel` row into the shape the callback receives. Custom field columns are stored
 * as `customFields<Name>` (embedded columns), and are grouped under `customFields`.
 */
function toMigrationChannel(row: Record<string, any>): IdentityScopeMigrationChannel {
    const customFields: Record<string, any> = {};
    for (const [column, value] of Object.entries(row)) {
        if (column.startsWith('customFields') && column.length > 'customFields'.length) {
            const name = column.slice('customFields'.length);
            customFields[name.charAt(0).toLowerCase() + name.slice(1)] = value;
        }
    }
    return { ...row, id: row.id, code: row.code, token: row.token, customFields };
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
            // Pending tokens stay with the original: two Users holding the same token would make
            // redeeming it depend on which row the database returns first.
            await copyRow(
                queryRunner,
                'authentication_method',
                m.id,
                {
                    userId: newUserId,
                    verificationToken: null,
                    passwordResetToken: null,
                    identifierChangeToken: null,
                    pendingIdentifier: null,
                },
                t,
                c,
                p,
            );
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
    const isPostgres = isPostgresFamily(queryRunner);
    const insert = `INSERT INTO ${t(table)} (${columns.map(c).join(', ')})
        VALUES (${columns.map((_, i) => p(i + 1)).join(', ')})${isPostgres ? ` RETURNING ${c('id')}` : ''}`;
    const params = columns.map(k => values[k]);
    if (isPostgres) {
        const [inserted] = await queryRunner.query(insert, params);
        return String(inserted.id);
    }
    await queryRunner.query(insert, params);
    const [{ id: newId }] = await queryRunner.query(`SELECT MAX(${c('id')}) AS ${c('id')} FROM ${t(table)}`);
    return String(newId);
}
