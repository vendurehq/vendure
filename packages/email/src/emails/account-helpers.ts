import {
    Administrator,
    Customer,
    Injector,
    NativeAuthenticationMethod,
    RequestContext,
    TransactionalConnection,
    User,
} from '@vendure/core';

/*
 * Helpers for the sample events of the account emails. Changes made to the loaded entities (such as
 * sample tokens) are never saved.
 */

type SampleInput = { ctx: RequestContext; injector: Injector; args: Record<string, string> };

export async function findSampleCustomerUser({ ctx, injector, args }: SampleInput): Promise<User | undefined> {
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

export async function findSampleAdministrator({
    ctx,
    injector,
    args,
}: SampleInput): Promise<{ administrator: Administrator; user: User } | undefined> {
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
    return { administrator, user };
}

function hasNativeAuth(user: User) {
    return !!user.authenticationMethods?.some(m => m instanceof NativeAuthenticationMethod);
}
