import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import {
    GLOBAL_IDENTITY_SCOPE,
    GlobalIdentityScopeStrategy,
} from '../../../config/auth/identity-scope-strategy';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { ChannelService } from '../../services/channel.service';

/**
 * @description
 * Resolves customer identity scopes using the configured {@link IdentityScopeStrategy}.
 * Use this service rather than calling the strategy directly: it always hands the strategy a
 * fully loaded Channel, so every caller gets the same scope for the same Channel.
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
    ) {}

    /**
     * A Customer whose scope no Channel maps to can never log in, be found by email address or
     * hold permissions. That happens when the strategy is changed without migrating, or when
     * Customers are inserted without going through the CustomerService (the column defaults to
     * `global`). Refuses to start in the first case and logs the second.
     */
    async onApplicationBootstrap() {
        const { identityScopeStrategy } = this.configService.authOptions;
        if (identityScopeStrategy instanceof GlobalIdentityScopeStrategy) {
            return;
        }
        const channels = await this.connection.rawConnection.getRepository(Channel).find();
        const scopes = [...new Set(await Promise.all(channels.map(ch => this.getScopeForChannel(ch))))];
        const orphaned: Array<{ identityScope: string; count: string }> = await this.connection.rawConnection
            .getRepository(Customer)
            .createQueryBuilder('customer')
            .select('customer.identityScope', 'identityScope')
            .addSelect('COUNT(*)', 'count')
            .where('customer.deletedAt IS NULL')
            .andWhere('customer.identityScope NOT IN (:...scopes)', { scopes })
            .groupBy('customer.identityScope')
            .getRawMany();
        if (!orphaned.length) {
            return;
        }
        const total = orphaned.reduce((sum, row) => sum + Number(row.count), 0);
        const inScope = await this.connection.rawConnection
            .getRepository(Customer)
            .createQueryBuilder('customer')
            .where('customer.deletedAt IS NULL')
            .andWhere('customer.identityScope IN (:...scopes)', { scopes })
            .getCount();
        const detail = orphaned.map(row => `${row.identityScope}: ${row.count}`).join(', ');
        if (inScope === 0 && orphaned.every(row => row.identityScope === GLOBAL_IDENTITY_SCOPE)) {
            throw new Error(
                `The configured IdentityScopeStrategy does not map any Channel to the "${GLOBAL_IDENTITY_SCOPE}" ` +
                    `scope, but all ${total} Customers are still in it. Run migrateCustomerIdentityScopes() ` +
                    `in a migration before switching strategy, or no Customer will be able to log in.`,
            );
        }
        Logger.error(
            `${total} Customers have an identity scope that no Channel maps to (${detail}). They cannot ` +
                `log in or be found by email address. Customers must be created through the CustomerService, ` +
                `which sets the scope.`,
        );
    }

    /**
     * @description
     * The identity scope of the given Channel. The Channel may be partially loaded (for example a
     * Customer's `channels` relation): it is resolved to the cached, fully loaded Channel first.
     */
    async getScopeForChannel(channel: Channel): Promise<string> {
        if (channel?.id == null) {
            // e.g. the empty Channel of `RequestContext.empty()`. Returning a scope here would
            // create or find Customers in a scope that no real Channel has.
            throw new InternalServerError('error.identity-scope-requires-channel');
        }
        const fullChannel = channel.token != null ? await this.loadChannel(channel) : channel;
        const scope =
            await this.configService.authOptions.identityScopeStrategy.getIdentityScope(fullChannel);
        if (typeof scope !== 'string' || scope.length === 0 || scope.length > 255) {
            throw new InternalServerError('error.invalid-identity-scope');
        }
        return scope;
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
     * Whether the Customer belongs to the identity scope of the given Channel, and so may be a
     * member of it and act on it in the Shop API.
     */
    async isCustomerInChannelScope(customer: Pick<Customer, 'identityScope'>, channel: Channel) {
        return customer.identityScope === (await this.getScopeForChannel(channel));
    }

    private async loadChannel(channel: Channel): Promise<Channel> {
        // Resolved lazily: ChannelService sits below many of the services that use this one.
        const channelService =
            this.channelService ?? (this.moduleRef.get(ChannelService, { strict: false }) as ChannelService);
        this.channelService = channelService;
        try {
            const loaded = await channelService.getChannelFromToken(channel.token);
            return String(loaded.id) === String(channel.id) ? loaded : channel;
        } catch {
            return channel;
        }
    }
}
