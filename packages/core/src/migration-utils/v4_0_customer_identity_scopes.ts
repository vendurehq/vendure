/* eslint-disable no-console */
// A one-time v4.0 helper for installs that opt into a non-global IdentityScopeStrategy. It must
// remain exported indefinitely: user migrations import it directly. Installs that keep the default
// GlobalIdentityScopeStrategy do not need it: the generated migration adds `customer.identityScope`
// with the default 'global'.
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

import { IdentityScopeStrategy } from '../config/auth/identity-scope-strategy';
import { Address } from '../entity/address/address.entity';
import { Channel } from '../entity/channel/channel.entity';
import { Customer } from '../entity/customer/customer.entity';
import { User } from '../entity/user/user.entity';
import { resolveIdentityScope } from '../service/helpers/identity-scope/identity-scope.service';

/**
 * @description
 * Passed to the `onCustomerSplit` option of {@link migrateCustomerIdentityScopes} for each copy it
 * creates, so that plugin data belonging to the Customer or User can be copied or moved too.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export interface CustomerSplit {
    originalCustomerId: string;
    copyCustomerId: string;
    originalUserId: string | null;
    copyUserId: string | null;
    identityScope: string;
    /** The ids of the Orders moved to the copy. */
    movedOrderIds: string[];
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
     * Channel counts as one of the Customer's storefronts if the Customer has an Order placed on
     * the default Channel only. Draft Orders, which administrators create, do not count. Set it to
     * `false` if the default Channel is not a storefront.
     *
     * @default true
     */
    defaultChannelIsStorefront?: boolean;
    /**
     * @description
     * Works out and returns what would change, without writing anything.
     *
     * @default false
     */
    dryRun?: boolean;
    /**
     * @description
     * Called for each copy created by a split, inside the migration's transaction. Use it to copy
     * or move data that plugins keep for the Customer or User, such as wishlists, loyalty
     * accounts or payment provider customer ids. The helper only copies core data.
     */
    onCustomerSplit?: (queryRunner: QueryRunner, split: CustomerSplit) => Promise<void>;
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
    /**
     * Email addresses that more than one live Customer has within one scope after the migration.
     * These existed before (for example a guest checkout beside an account, or addresses that
     * differ only in case) and were shared across Channels. Merge or rename them: a lookup by
     * email address picks one of them.
     */
    duplicateEmails: Array<{ identityScope: string; emailAddress: string; customerIds: string[] }>;
}

type PlannedSplit = {
    customerId: string;
    primary: string;
    others: Array<{ scope: string; channelIds: string[]; orderIds: string[] }>;
};

/**
 * @description
 * Moves existing Customers into the identity scopes of a non-global {@link IdentityScopeStrategy}.
 * Pass the same strategy instance as in your config, so that the migration and the server derive
 * scopes the same way.
 *
 * Before v4 a Customer is shared by every Channel it has joined. For each Customer this helper
 * works out the scopes of the Channels it uses. Pre-v4 versions joined every Customer to the
 * default Channel, so that membership only counts if it is the Customer's only one, or if
 * `defaultChannelIsStorefront` is on and the Customer has a non-draft Order placed on the default
 * Channel only.
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
 *   Admin API. History entries stay on the original. Custom fields are copied, including list
 *   relation custom fields stored in join tables. Plugin data is not copied: use `onCustomerSplit`.
 *
 * Splitting needs auto-increment ids, and refuses to run when Customer, User or Address has a
 * unique custom field, because the copy would break the constraint. Both are checked before
 * anything is written.
 *
 * Run it with `dryRun: true` first to see what it will do. Then run it in a migration after the
 * `customer.identityScope` column has been created. Sessions cached before the migration are
 * treated as logged out until they expire from the session cache (`sessionCacheTTL`). It is
 * idempotent only for unsplit Customers, so run it once.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function migrateCustomerIdentityScopes(
    queryRunner: QueryRunner,
    strategy: Pick<IdentityScopeStrategy, 'getIdentityScope'>,
    options: CustomerIdentityScopeMigrationOptions = {},
): Promise<CustomerIdentityScopeMigrationResult> {
    const defaultChannelIsStorefront = options.defaultChannelIsStorefront ?? true;
    const sql = new Sql(queryRunner);

    // The same Channel shape the server hands the strategy.
    const channels = await queryRunner.manager.getRepository(Channel).find({
        relations: { defaultShippingZone: true, defaultTaxZone: true },
    });
    const scopeByChannel = new Map<string, string>();
    for (const channel of channels) {
        scopeByChannel.set(String(channel.id), await resolveIdentityScope(strategy, channel));
    }
    const defaultChannel = channels.find(ch => ch.code === DEFAULT_CHANNEL_CODE);
    const defaultChannelId = defaultChannel ? String(defaultChannel.id) : undefined;
    const scopeOf = (channelId: string): string => {
        const scope = scopeByChannel.get(channelId);
        if (scope === undefined) {
            throw new Error(`No Channel with id ${channelId} found`);
        }
        return scope;
    };
    const byChannelId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

    const customers: Array<{ id: any; emailAddress: string; userId: any; deletedAt: any }> = await sql.query(
        `SELECT ${sql.c('id')}, ${sql.c('emailAddress')}, ${sql.c('userId')}, ${sql.c('deletedAt')}
         FROM ${sql.t('customer')}`,
    );
    const memberships: Array<{ customerId: any; channelId: any }> = await sql.query(
        `SELECT ${sql.c('customerId')}, ${sql.c('channelId')} FROM ${sql.t('customer_channels_channel')}`,
    );
    const orderRows: Array<{ id: any; customerId: any; state: string; channelId: any }> = await sql.query(
        `SELECT o.${sql.c('id')}, o.${sql.c('customerId')}, o.${sql.c('state')}, oc.${sql.c('channelId')}
         FROM ${sql.t('order')} o
         INNER JOIN ${sql.t('order_channels_channel')} oc ON oc.${sql.c('orderId')} = o.${sql.c('id')}
         WHERE o.${sql.c('customerId')} IS NOT NULL`,
    );

    const channelsByCustomer = new Map<string, string[]>();
    for (const m of memberships) {
        addTo(channelsByCustomer, String(m.customerId), String(m.channelId));
    }
    const ordersByCustomer = new Map<string, Map<string, { state: string; channelIds: string[] }>>();
    for (const o of orderRows) {
        const orders = ordersByCustomer.get(String(o.customerId)) ?? new Map();
        const order = orders.get(String(o.id)) ?? { state: o.state, channelIds: [] };
        order.channelIds.push(String(o.channelId));
        orders.set(String(o.id), order);
        ordersByCustomer.set(String(o.customerId), orders);
    }

    // Plan first, so that a dry run and the checks below see the whole picture before any write.
    const singleScope = new Map<string, string[]>();
    const splits: PlannedSplit[] = [];
    const finalScopes: Array<{ customerId: string; scope: string }> = [];
    let withoutChannel = 0;
    for (const customer of customers) {
        const customerId = String(customer.id);
        const channelIds = channelsByCustomer.get(customerId);
        if (!channelIds) {
            if (defaultChannelId) {
                addTo(singleScope, scopeOf(defaultChannelId), customerId);
                finalScopes.push({ customerId, scope: scopeOf(defaultChannelId) });
                withoutChannel++;
            }
            continue;
        }
        const orders =
            ordersByCustomer.get(customerId) ?? new Map<string, { state: string; channelIds: string[] }>();
        const orderScope = new Map<string, string>();
        for (const [orderId, order] of orders) {
            // An Order on another Channel is also joined to the default Channel, so an Order joined
            // to the default Channel only was placed there.
            const placedOn = order.channelIds.filter(id => id !== defaultChannelId).sort(byChannelId)[0];
            orderScope.set(orderId, scopeOf(placedOn ?? order.channelIds[0]));
        }
        const usedDefaultAsStorefront =
            defaultChannelIsStorefront &&
            [...orders.values()].some(
                order => order.state !== 'Draft' && order.channelIds.every(id => id === defaultChannelId),
            );
        const nonDefault = channelIds.filter(id => id !== defaultChannelId);
        const relevant = channelIds.filter(
            id => id !== defaultChannelId || usedDefaultAsStorefront || nonDefault.length === 0,
        );
        const scopes = [...new Set(relevant.map(scopeOf))];
        if (scopes.length === 1) {
            addTo(singleScope, scopes[0], customerId);
            finalScopes.push({ customerId, scope: scopes[0] });
            continue;
        }
        const orderCount = (scope: string) => [...orderScope.values()].filter(v => v === scope).length;
        const lowestChannelOf = (scope: string) =>
            relevant.filter(id => scopeOf(id) === scope).sort(byChannelId)[0];
        const [primary, ...others] = [...scopes].sort(
            (a, b) => orderCount(b) - orderCount(a) || byChannelId(lowestChannelOf(a), lowestChannelOf(b)),
        );
        splits.push({
            customerId,
            primary,
            others: others.map(scope => ({
                scope,
                // The original keeps its default Channel membership. Each copy gets its own.
                channelIds: relevant.filter(id => scopeOf(id) === scope && id !== defaultChannelId),
                orderIds: [...orderScope].filter(([, s]) => s === scope).map(([id]) => id),
            })),
        });
        finalScopes.push({ customerId, scope: primary });
        for (const other of others) {
            finalScopes.push({ customerId, scope: other });
        }
    }

    const liveById = new Map(customers.filter(c => c.deletedAt == null).map(c => [String(c.id), c]));
    const byScopeAndEmail = new Map<string, string[]>();
    for (const { customerId, scope } of finalScopes) {
        const email = liveById.get(customerId)?.emailAddress;
        if (email != null) {
            addTo(byScopeAndEmail, `${scope}\u0000${email.toLowerCase()}`, customerId);
        }
    }
    const result: CustomerIdentityScopeMigrationResult = {
        assigned: [...singleScope.values()].reduce((sum, ids) => sum + ids.length, 0) - withoutChannel,
        withoutChannel,
        split: splits.length,
        copiesCreated: splits.reduce((sum, s) => sum + s.others.length, 0),
        duplicateEmails: [...byScopeAndEmail]
            .filter(([, ids]) => new Set(ids).size > 1)
            .map(([key, ids]) => {
                const [identityScope, emailAddress] = key.split('\u0000');
                return { identityScope, emailAddress, customerIds: [...new Set(ids)] };
            }),
    };

    if (splits.length) {
        assertCanCopyRows(queryRunner);
    }
    if (!options.dryRun) {
        for (const [scope, ids] of singleScope) {
            await sql.updateScope(ids, scope);
        }
        for (const split of splits) {
            await applySplit(sql, split, defaultChannelId, customers, options, queryRunner);
        }
    }
    console.log(
        `Customer identity scopes${options.dryRun ? ' (dry run)' : ''}: ${result.assigned} assigned, ` +
            `${result.withoutChannel} without a Channel given the default Channel's scope, ${result.split} ` +
            `split into ${result.copiesCreated} additional Customers, ${result.duplicateEmails.length} ` +
            `email addresses shared by several Customers within a scope`,
    );
    return result;
}

async function applySplit(
    sql: Sql,
    split: PlannedSplit,
    defaultChannelId: string | undefined,
    customers: Array<{ id: any; userId: any }>,
    options: CustomerIdentityScopeMigrationOptions,
    queryRunner: QueryRunner,
) {
    await sql.updateScope([split.customerId], split.primary);
    const original = customers.find(c => String(c.id) === split.customerId);
    for (const other of split.others) {
        const copy = await copyCustomer(sql, split.customerId, other.scope);
        for (const channelId of other.channelIds) {
            await sql.query(
                `UPDATE ${sql.t('customer_channels_channel')} SET ${sql.c('customerId')} = ${sql.p(1)}
                 WHERE ${sql.c('customerId')} = ${sql.p(2)} AND ${sql.c('channelId')} = ${sql.p(3)}`,
                [copy.customerId, split.customerId, channelId],
            );
        }
        if (defaultChannelId) {
            // Every Customer stays visible on the default Channel in the Admin API.
            await sql.query(
                `INSERT INTO ${sql.t('customer_channels_channel')} (${sql.c('customerId')}, ${sql.c('channelId')})
                 VALUES (${sql.p(1)}, ${sql.p(2)})`,
                [copy.customerId, defaultChannelId],
            );
        }
        for (const orderId of other.orderIds) {
            await sql.query(
                `UPDATE ${sql.t('order')} SET ${sql.c('customerId')} = ${sql.p(1)} WHERE ${sql.c('id')} = ${sql.p(2)}`,
                [copy.customerId, orderId],
            );
            // A session of the original User must not keep driving an Order of the copy.
            await sql.query(
                `UPDATE ${sql.t('session')} SET ${sql.c('activeOrderId')} = NULL
                 WHERE ${sql.c('activeOrderId')} = ${sql.p(1)}`,
                [orderId],
            );
        }
        await options.onCustomerSplit?.(queryRunner, {
            originalCustomerId: split.customerId,
            copyCustomerId: copy.customerId,
            originalUserId: original?.userId != null ? String(original.userId) : null,
            copyUserId: copy.userId,
            identityScope: other.scope,
            movedOrderIds: other.orderIds,
        });
    }
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
}

/**
 * Splitting inserts copies of Customer, User, AuthenticationMethod and Address rows. That needs
 * database-generated ids, and fails on a unique custom field, so both are checked before anything
 * is written.
 */
function assertCanCopyRows(queryRunner: QueryRunner) {
    for (const entity of [Customer, User, Address]) {
        const metadata = queryRunner.connection.getMetadata(entity);
        const generation = metadata.primaryColumns[0]?.generationStrategy;
        if (generation !== 'increment') {
            throw new Error(
                `migrateCustomerIdentityScopes() can only split Customers with auto-increment ids, but ` +
                    `${metadata.name} ids are generated by "${generation ?? 'the application'}".`,
            );
        }
        const uniqueCustomFields = [...metadata.uniques, ...metadata.indices.filter(i => i.isUnique)]
            .flatMap(u => u.columns)
            .filter(col => col.propertyPath.startsWith('customFields.'));
        if (uniqueCustomFields.length) {
            throw new Error(
                `migrateCustomerIdentityScopes() cannot split Customers: ${metadata.name} has unique custom ` +
                    `fields (${uniqueCustomFields.map(col => col.propertyPath).join(', ')}), which a copy ` +
                    `would duplicate.`,
            );
        }
    }
}

async function copyCustomer(
    sql: Sql,
    customerId: string,
    scope: string,
): Promise<{ customerId: string; userId: string | null }> {
    const [customer] = await sql.query(
        `SELECT ${sql.c('userId')} FROM ${sql.t('customer')} WHERE ${sql.c('id')} = ${sql.p(1)}`,
        [customerId],
    );
    let copyUserId: string | null = null;
    if (customer.userId != null) {
        copyUserId = await sql.copyRow('user', customer.userId, {});
        await sql.copyListCustomFields(User, customer.userId, copyUserId);
        const methods: Array<{ id: any }> = await sql.query(
            `SELECT ${sql.c('id')} FROM ${sql.t('authentication_method')} WHERE ${sql.c('userId')} = ${sql.p(1)}`,
            [customer.userId],
        );
        for (const m of methods) {
            // Pending tokens stay with the original: two Users holding the same token would make
            // redeeming it depend on which row the database returns first.
            await sql.copyRow('authentication_method', m.id, {
                userId: copyUserId,
                verificationToken: null,
                passwordResetToken: null,
                identifierChangeToken: null,
                pendingIdentifier: null,
            });
        }
    }
    const copyId = await sql.copyRow('customer', customerId, { identityScope: scope, userId: copyUserId });
    await sql.copyListCustomFields(Customer, customerId, copyId);
    const addresses: Array<{ id: any }> = await sql.query(
        `SELECT ${sql.c('id')} FROM ${sql.t('address')} WHERE ${sql.c('customerId')} = ${sql.p(1)}`,
        [customerId],
    );
    for (const a of addresses) {
        const copyAddressId = await sql.copyRow('address', a.id, { customerId: copyId });
        await sql.copyListCustomFields(Address, a.id, copyAddressId);
    }
    const groups: Array<{ customerGroupId: any }> = await sql.query(
        `SELECT ${sql.c('customerGroupId')} FROM ${sql.t('customer_groups_customer_group')}
         WHERE ${sql.c('customerId')} = ${sql.p(1)}`,
        [customerId],
    );
    for (const g of groups) {
        await sql.query(
            `INSERT INTO ${sql.t('customer_groups_customer_group')} (${sql.c('customerId')}, ${sql.c('customerGroupId')})
             VALUES (${sql.p(1)}, ${sql.p(2)})`,
            [copyId, g.customerGroupId],
        );
    }
    return { customerId: copyId, userId: copyUserId };
}

/** Raw SQL that works on every supported database. */
class Sql {
    private readonly type: string;

    constructor(private queryRunner: QueryRunner) {
        this.type = queryRunner.connection.driver.options.type;
    }

    get isPostgres() {
        return ['postgres', 'cockroachdb', 'aurora-postgres'].includes(this.type);
    }

    get isMysql() {
        return ['mysql', 'mariadb', 'aurora-mysql'].includes(this.type);
    }

    t(name: string) {
        const prefix = this.queryRunner.connection.options.entityPrefix ?? '';
        return this.queryRunner.connection.driver.escape(`${prefix}${name}`);
    }

    c(name: string) {
        return this.queryRunner.connection.driver.escape(name);
    }

    p(i: number) {
        return this.isPostgres ? `$${i}` : '?';
    }

    query(query: string, parameters?: any[]): Promise<any> {
        return this.queryRunner.query(query, parameters);
    }

    /**
     * List relation custom fields are stored in join tables rather than columns of the row, so
     * `copyRow` does not copy them. This copies the join rows of every list relation custom field
     * of the entity from one row to another.
     */
    async copyListCustomFields(
        entity: typeof Customer | typeof User | typeof Address,
        fromId: any,
        toId: any,
    ) {
        const metadata = this.queryRunner.connection.getMetadata(entity);
        const junctions = metadata.manyToManyRelations
            .filter(r => r.isOwning && r.propertyPath.startsWith('customFields.'))
            .map(r => r.junctionEntityMetadata)
            .filter(junction => junction !== undefined);
        for (const junction of junctions) {
            const owner = junction.ownerColumns[0].databaseName;
            const inverse = junction.inverseColumns[0].databaseName;
            const table = this.queryRunner.connection.driver.escape(junction.tableName);
            await this.query(
                `INSERT INTO ${table} (${this.c(owner)}, ${this.c(inverse)})
                 SELECT ${this.p(1)}, ${this.c(inverse)} FROM ${table} WHERE ${this.c(owner)} = ${this.p(2)}`,
                [toId, fromId],
            );
        }
    }

    async updateScope(customerIds: string[], scope: string) {
        for (let i = 0; i < customerIds.length; i += 500) {
            const batch = customerIds.slice(i, i + 500);
            await this.query(
                `UPDATE ${this.t('customer')} SET ${this.c('identityScope')} = ${this.p(1)}
                 WHERE ${this.c('id')} IN (${batch.map((_, j) => this.p(j + 2)).join(', ')})`,
                [scope, ...batch],
            );
        }
    }

    /**
     * Copies one row, leaving out its id so the database assigns a new one, and returns the new id
     * as the database reports it for this insert.
     */
    async copyRow(table: string, id: any, overrides: Record<string, any>): Promise<string> {
        const [row] = await this.query(
            `SELECT * FROM ${this.t(table)} WHERE ${this.c('id')} = ${this.p(1)}`,
            [id],
        );
        const values = { ...row, ...overrides };
        delete values.id;
        const columns = Object.keys(values);
        const insert = `INSERT INTO ${this.t(table)} (${columns.map(col => this.c(col)).join(', ')})
            VALUES (${columns.map((_, i) => this.p(i + 1)).join(', ')})`;
        const params = columns.map(k => values[k]);
        if (this.isPostgres) {
            const [inserted] = await this.query(`${insert} RETURNING ${this.c('id')}`, params);
            return String(inserted.id);
        }
        const result = await this.query(insert, params);
        if (this.isMysql) {
            return String(result.insertId);
        }
        // SQLite drivers: the rowid of the last insert on this connection.
        const [{ id: newId }] = await this.query('SELECT last_insert_rowid() AS id');
        return String(newId);
    }
}
