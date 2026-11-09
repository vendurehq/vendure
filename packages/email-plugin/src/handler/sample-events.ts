import {
    AccountRegistrationEvent,
    Administrator,
    AdministratorPasswordResetEvent,
    Customer,
    IdentifierChangeRequestEvent,
    Injector,
    NativeAuthenticationMethod,
    Order,
    OrderService,
    OrderStateTransitionEvent,
    PasswordResetEvent,
    RequestContext,
    TransactionalConnection,
    User,
} from '@vendure/core';

/*
 * Sample events for the default email handlers, built from the data in the database. They are used by
 * the dev mode tooling to render and send emails without triggering the real events. Changes made to the
 * loaded entities (such as sample tokens) are never saved.
 */

type SampleInput = { ctx: RequestContext; injector: Injector; args: Record<string, string> };

/**
 * Uses the order given by `args.order` (code or ID), or else the most recently placed order with a
 * customer in the current channel.
 */
export async function sampleOrderPlacedEvent({ ctx, injector, args }: SampleInput) {
    const orderService = injector.get(OrderService);
    let order: Order | undefined;
    if (args.order) {
        order =
            (await orderService.findOneByCode(ctx, args.order)) ??
            (await orderService.findOne(ctx, args.order));
    } else {
        const latest = await injector
            .get(TransactionalConnection)
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('order.orderPlacedAt IS NOT NULL')
            .andWhere('order.customerId IS NOT NULL')
            .orderBy('order.orderPlacedAt', 'DESC')
            .select(['order.id'])
            .getOne();
        order = latest ? await orderService.findOne(ctx, latest.id) : undefined;
    }
    if (!order) {
        return undefined;
    }
    return new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', ctx, order);
}

export async function sampleAccountRegistrationEvent(input: SampleInput) {
    const user = await findCustomerUser(input);
    if (!user) {
        return undefined;
    }
    const nativeAuth = user.getNativeAuthenticationMethod();
    nativeAuth.verificationToken = nativeAuth.verificationToken ?? 'sample-verification-token';
    return new AccountRegistrationEvent(input.ctx, user);
}

export async function samplePasswordResetEvent(input: SampleInput) {
    const user = await findCustomerUser(input);
    if (!user) {
        return undefined;
    }
    const nativeAuth = user.getNativeAuthenticationMethod();
    nativeAuth.passwordResetToken = nativeAuth.passwordResetToken ?? 'sample-password-reset-token';
    return new PasswordResetEvent(input.ctx, user);
}

export async function sampleEmailAddressChangeEvent(input: SampleInput) {
    const user = await findCustomerUser(input);
    if (!user) {
        return undefined;
    }
    const nativeAuth = user.getNativeAuthenticationMethod();
    nativeAuth.identifierChangeToken = nativeAuth.identifierChangeToken ?? 'sample-identifier-change-token';
    nativeAuth.pendingIdentifier =
        input.args.newEmail ?? nativeAuth.pendingIdentifier ?? `new.${nativeAuth.identifier}`;
    return new IdentifierChangeRequestEvent(input.ctx, user);
}

/**
 * Uses the administrator with the email address given by `args.email`, or else the most recently
 * created administrator.
 */
export async function sampleAdminPasswordResetEvent({ ctx, injector, args }: SampleInput) {
    const administrator = await injector
        .get(TransactionalConnection)
        .getRepository(ctx, Administrator)
        .findOne({
            where: args.email ? { emailAddress: args.email } : {},
            relations: { user: { authenticationMethods: true } },
            order: { createdAt: 'DESC' },
        });
    const user = administrator?.user;
    if (!administrator || !user || !hasNativeAuth(user)) {
        return undefined;
    }
    const nativeAuth = user.getNativeAuthenticationMethod();
    nativeAuth.passwordResetToken = nativeAuth.passwordResetToken ?? 'sample-password-reset-token';
    return new AdministratorPasswordResetEvent(ctx, administrator, user);
}

/**
 * Finds the User of the customer with the email address given by `args.email`, or else of the most
 * recently created registered customer in the current channel.
 */
async function findCustomerUser({ ctx, injector, args }: SampleInput): Promise<User | undefined> {
    const qb = injector
        .get(TransactionalConnection)
        .getRepository(ctx, Customer)
        .createQueryBuilder('customer')
        .innerJoin('customer.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
        .innerJoinAndSelect('customer.user', 'user')
        .leftJoinAndSelect('user.authenticationMethods', 'authenticationMethod')
        .where('customer.deletedAt IS NULL')
        .orderBy('customer.createdAt', 'DESC');
    if (args.email) {
        qb.andWhere('customer.emailAddress = :email', { email: args.email });
    }
    const customers = await qb.take(20).getMany();
    return customers.map(c => c.user).find((u): u is User => !!u && hasNativeAuth(u));
}

function hasNativeAuth(user: User) {
    return !!user.authenticationMethods?.some(m => m instanceof NativeAuthenticationMethod);
}
