import { Injectable } from '@nestjs/common';
import {
    AdministratorService,
    CustomerService,
    ID,
    RequestContext,
    RequestContextCacheService,
} from '@vendure/core';

import { McpActorType, McpGrantUserType } from '../types';

interface McpActorIdentity {
    name: string | null;
    customerId: ID | null;
}

const NO_ACTOR: McpActorIdentity = { name: null, customerId: null };

function fullName(person: { firstName: string; lastName: string }): string {
    return `${person.firstName} ${person.lastName}`.trim();
}

/**
 * Turns the user id stored on a tool-call log or an OAuth grant into a display name, and into a
 * Customer id when the user is a customer.
 */
@Injectable()
export class McpActorService {
    constructor(
        private readonly customerService: CustomerService,
        private readonly administratorService: AdministratorService,
        private readonly requestContextCache: RequestContextCacheService,
    ) {}

    // Cached for the request's lifetime, since a list page asks for the same actor on many rows.
    resolveIdentity(
        ctx: RequestContext,
        userId: ID | string | null | undefined,
        actorType: McpActorType | McpGrantUserType | null | undefined,
    ): Promise<McpActorIdentity> {
        if (userId == null || actorType == null || actorType === 'anonymous') {
            return Promise.resolve(NO_ACTOR);
        }
        return this.requestContextCache.get(ctx, `McpActorService:${actorType}:${String(userId)}`, () =>
            this.lookUpIdentity(ctx, userId, actorType),
        );
    }

    private async lookUpIdentity(
        ctx: RequestContext,
        userId: ID | string,
        actorType: McpActorType | McpGrantUserType,
    ): Promise<McpActorIdentity> {
        if (actorType === 'customer') {
            const customer = await this.customerService.findOneByUserId(ctx, userId);
            return customer ? { name: fullName(customer), customerId: customer.id } : NO_ACTOR;
        }
        const administrator = await this.administratorService.findOneByUserId(ctx, userId);
        return administrator ? { name: fullName(administrator), customerId: null } : NO_ACTOR;
    }
}
