import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import {
    GLOBAL_IDENTITY_SCOPE,
    GlobalIdentityScopeStrategy,
    IdentityScopeStrategy,
} from '../../../config/auth/identity-scope-strategy';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { ProcessContext } from '../../../process-context/process-context';
import { ChannelService } from '../../services/channel.service';

const IDENTITY_SCOPE_MISMATCH_ADVICE =
    'No data has been changed. If you changed the IdentityScopeStrategy, migrate the Customers to the new ' +
    'scopes with migrateCustomerIdentityScopes() from a database migration, or go back to the previous ' +
    'strategy. Do not change the inputs a strategy reads once Customers exist. See ' +
    'https://docs.vendure.io/current/framework/core-concepts/customers#changing-the-strategy-on-an-existing-install';

/**
 * @description
 * Resolves customer identity scopes using the configured {@link IdentityScopeStrategy}.
 * Use this service rather than calling the strategy directly: it always hands the strategy the
 * same loaded Channel (its columns, including `sellerId` and custom fields), so every caller gets
 * the same scope for the same Channel.
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
export class IdentityScopeService implements OnApplicationBootstrap {
    private channelService: ChannelService | undefined;

    constructor(
        private readonly configService: ConfigService,
        private readonly moduleRef: ModuleRef,
        private readonly connection: TransactionalConnection,
        private readonly processContext: ProcessContext,
    ) {}

    /**
     * Checks that the identity scopes stored on Customers still match the strategy, and refuses to
     * start if they do not. Nothing is lost when they do not match, but every affected Customer is
     * locked out: they cannot log in or be found by email address, and registering again creates a
     * second Customer beside them. This happens when the strategy is changed without migrating
     * (including going back to the global strategy), or when an input the strategy reads, such as
     * a Channel custom field, changes while the server is down.
     *
     * Refuses to start when all members of a non-default Channel are stored in another scope, or
     * when no Customer is stored in a scope that any Channel has (which also covers installs whose
     * Customers only use the default Channel). Logs a partial mismatch, which Customers created
     * outside the CustomerService can cause. Runs in the server process only.
     */
    async onApplicationBootstrap() {
        if (this.processContext.isWorker) {
            // The server checks; every worker doing the same scan would only add startup time.
            return;
        }
        const channels = await this.connection.rawConnection.getRepository(Channel).find();
        const resolved = await Promise.all(channels.map(channel => this.getScopeForLoadedChannel(channel)));
        const scopeByChannel = new Map(channels.map((channel, i) => [String(channel.id), resolved[i]]));
        const knownScopes = [...new Set(resolved)];

        const { lockedOut, partial } = await this.findChannelScopeMismatches(channels, scopeByChannel);
        const { live, orphaned } = await this.countCustomersOutsideKnownScopes(knownScopes);

        if (lockedOut.length) {
            throw new Error(
                `The identity scopes stored on Customers do not match the configured ` +
                    `IdentityScopeStrategy, so no Customer of these Channels could log in: ` +
                    `${lockedOut.join('; ')}. ${IDENTITY_SCOPE_MISMATCH_ADVICE}`,
            );
        }
        if (live > 0 && orphaned === live) {
            throw new Error(
                `None of the ${live} Customers is stored in an identity scope that the configured ` +
                    `IdentityScopeStrategy gives a Channel (${knownScopes.map(scope => `"${scope}"`).join(', ')}), ` +
                    `so no Customer could log in. ${IDENTITY_SCOPE_MISMATCH_ADVICE}`,
            );
        }
        if (partial.length) {
            Logger.error(
                `Some Customers are members of Channels outside their identity scope and cannot act ` +
                    `on them: ${partial.join('; ')}`,
            );
        }
        if (orphaned) {
            Logger.error(
                `${orphaned} Customers have an identity scope that no Channel maps to. They cannot log ` +
                    `in or be found by email address. Create Customers through the CustomerService, which ` +
                    `sets the scope.`,
            );
        }
    }

    /**
     * For each non-default Channel, the members stored in a scope other than the Channel's. The
     * default Channel is left out: every Customer is a member of it, whatever its scope.
     */
    private async findChannelScopeMismatches(channels: Channel[], scopeByChannel: Map<string, string>) {
        const rows: Array<{ channelId: ID; identityScope: string; count: string | number }> =
            await this.connection.rawConnection
                .getRepository(Customer)
                .createQueryBuilder('customer')
                .innerJoin('customer.channels', 'channel')
                .select('channel.id', 'channelId')
                .addSelect('customer.identityScope', 'identityScope')
                .addSelect('COUNT(*)', 'count')
                .where('customer.deletedAt IS NULL')
                .andWhere('channel.code != :defaultCode', { defaultCode: DEFAULT_CHANNEL_CODE })
                .groupBy('channel.id')
                .addGroupBy('customer.identityScope')
                .getRawMany();
        const lockedOut: string[] = [];
        const partial: string[] = [];
        for (const channel of channels.filter(ch => ch.code !== DEFAULT_CHANNEL_CODE)) {
            const scope = scopeByChannel.get(String(channel.id));
            const members = rows.filter(r => String(r.channelId) === String(channel.id));
            const mismatched = members.filter(r => r.identityScope !== scope);
            if (!mismatched.length) {
                continue;
            }
            const detail = `"${channel.code}" (scope "${scope}"): ${mismatched
                .map(r => `${Number(r.count)} in "${r.identityScope}"`)
                .join(', ')}`;
            (mismatched.length === members.length ? lockedOut : partial).push(detail);
        }
        return { lockedOut, partial };
    }

    private async countCustomersOutsideKnownScopes(knownScopes: string[]) {
        const customers = () =>
            this.connection.rawConnection
                .getRepository(Customer)
                .createQueryBuilder('customer')
                .where('customer.deletedAt IS NULL');
        const live = await customers().getCount();
        const orphaned = live
            ? await customers()
                  .andWhere('customer.identityScope NOT IN (:...knownScopes)', { knownScopes })
                  .getCount()
            : 0;
        return { live, orphaned };
    }

    /**
     * @description
     * The identity scope of the given Channel. The Channel may be partially loaded (for example a
     * Customer's `channels` relation): it is loaded first, so the strategy always sees the same
     * Channel.
     */
    async getScopeForChannel(channel: Channel): Promise<string> {
        if (this.isGlobal()) {
            // Needs no Channel, so contexts without one (e.g. `RequestContext.empty()`) keep
            // working as before under the default strategy.
            return GLOBAL_IDENTITY_SCOPE;
        }
        if (channel?.id == null) {
            // Returning a scope here would create or find Customers in a scope no Channel has.
            throw new InternalServerError('error.identity-scope-requires-channel');
        }
        return this.getScopeForLoadedChannel(await this.loadChannel(channel));
    }

    /**
     * @description
     * The identity scope of a Channel which is already fully loaded, such as one about to be
     * saved. Validates the key the strategy returns.
     */
    async getScopeForLoadedChannel(channel: Channel): Promise<string> {
        return resolveIdentityScope(this.configService.authOptions.identityScopeStrategy, channel);
    }

    /**
     * @description
     * The identity scope of the active Channel. Every lookup of a Customer or customer User by
     * email address is limited to this scope.
     */
    async getActiveScope(ctx: RequestContext): Promise<string> {
        return this.getScopeForChannel(ctx.channel);
    }

    /**
     * @description
     * The Channels whose identity scope is the given one, that is, the Channels whose customer
     * base a Customer in that scope belongs to.
     */
    async getChannelsInScope(identityScope: string): Promise<Channel[]> {
        const channels = await this.connection.rawConnection.getRepository(Channel).find({
            relations: { defaultShippingZone: true, defaultTaxZone: true },
        });
        const resolved = await Promise.all(channels.map(channel => this.getScopeForLoadedChannel(channel)));
        return channels.filter((_, i) => resolved[i] === identityScope);
    }

    /**
     * @description
     * Whether every Channel shares one customer base, as with the default
     * {@link GlobalIdentityScopeStrategy}.
     */
    isGlobal(): boolean {
        return this.configService.authOptions.identityScopeStrategy instanceof GlobalIdentityScopeStrategy;
    }

    /**
     * @description
     * Whether the Customer belongs to the identity scope of the given Channel, and so may act on
     * it in the Shop API.
     */
    async isCustomerInChannelScope(customer: Pick<Customer, 'identityScope'>, channel: Channel) {
        return customer.identityScope === (await this.getScopeForChannel(channel));
    }

    /** Resolved lazily: ChannelService sits below many of the services that use this one. */
    private getChannelService(): ChannelService {
        this.channelService ??= this.moduleRef.get(ChannelService, { strict: false });
        if (!this.channelService) {
            throw new InternalServerError('ChannelService is not available');
        }
        return this.channelService;
    }

    private async loadChannel(channel: Channel): Promise<Channel> {
        if (channel.token != null) {
            const cached = await this.getChannelService().getChannelFromToken(channel.token);
            if (String(cached.id) === String(channel.id)) {
                return cached;
            }
        }
        // No token, or the token now belongs to another Channel: load by id.
        const loaded = await this.connection.rawConnection.getRepository(Channel).findOne({
            where: { id: channel.id },
            relations: { defaultShippingZone: true, defaultTaxZone: true },
        });
        if (!loaded) {
            throw new InternalServerError('error.identity-scope-requires-channel');
        }
        return loaded;
    }
}

/**
 * Calls the strategy and validates the key it returns. Shared with the migration helper, so that
 * the migration and the running server derive scopes the same way.
 */
export async function resolveIdentityScope(
    strategy: Pick<IdentityScopeStrategy, 'getIdentityScope'>,
    channel: Channel,
): Promise<string> {
    const scope = await strategy.getIdentityScope(channel);
    if (typeof scope !== 'string' || scope.length === 0 || scope.length > 255) {
        throw new InternalServerError('error.invalid-identity-scope');
    }
    return scope;
}
