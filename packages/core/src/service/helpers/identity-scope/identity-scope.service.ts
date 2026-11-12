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
        private configService: ConfigService,
        private moduleRef: ModuleRef,
        private connection: TransactionalConnection,
        private processContext: ProcessContext,
    ) {}

    /**
     * Checks that the stored scopes still match the strategy. A Customer can only act on Channels
     * in its own scope, so a mismatch locks Customers out. It happens when the strategy is changed
     * without migrating (including going back to the global strategy), when a strategy's input such
     * as a Channel custom field changes while the server is down, or when Customers are created
     * without going through the CustomerService.
     *
     * Every non-default Channel's members should be in that Channel's scope. A Channel none of
     * whose members are refuses the start; a partial mismatch, or Customers in a scope no Channel
     * has, is logged. Runs in the server process only.
     */
    async onApplicationBootstrap() {
        if (this.processContext.isWorker) {
            // The server checks; every worker doing the same scan would only add startup time.
            return;
        }
        const channels = await this.connection.rawConnection.getRepository(Channel).find();
        const scopeByChannel = new Map<string, string>();
        for (const channel of channels) {
            scopeByChannel.set(String(channel.id), await this.getScopeForLoadedChannel(channel));
        }
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
        if (lockedOut.length) {
            throw new Error(
                `The configured IdentityScopeStrategy does not match the identity scopes stored on ` +
                    `Customers, so no member of these Channels could log in: ${lockedOut.join('; ')}. ` +
                    `Run migrateCustomerIdentityScopes() when changing the strategy, and do not change ` +
                    `the inputs the strategy reads once Customers exist.`,
            );
        }
        if (partial.length) {
            Logger.error(
                `Some Customers are members of Channels outside their identity scope and cannot act ` +
                    `on them: ${partial.join('; ')}`,
            );
        }
        const knownScopes = [...new Set(scopeByChannel.values())];
        const orphaned = await this.connection.rawConnection
            .getRepository(Customer)
            .createQueryBuilder('customer')
            .where('customer.deletedAt IS NULL')
            .andWhere('customer.identityScope NOT IN (:...knownScopes)', { knownScopes })
            .getCount();
        if (orphaned) {
            Logger.error(
                `${orphaned} Customers have an identity scope that no Channel maps to. They cannot log ` +
                    `in or be found by email address. Create Customers through the CustomerService, which ` +
                    `sets the scope.`,
            );
        }
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
        const inScope: Channel[] = [];
        for (const channel of channels) {
            if ((await this.getScopeForLoadedChannel(channel)) === identityScope) {
                inScope.push(channel);
            }
        }
        return inScope;
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
