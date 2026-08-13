/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Administrator,
    Ctx,
    EventBus,
    InternalServerError,
    NativeAuthenticationMethod,
    PluginCommonModule,
    RequestContext,
    Transaction,
    TransactionalConnection,
    User,
    VendureEvent,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';
import { ReplaySubject, Subscription } from 'rxjs';
import { vi } from 'vitest';

export class TestEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public administrator: Administrator,
    ) {
        super();
    }
}

export const TRIGGER_NO_OPERATION = 'trigger-no-operation';
export const TRIGGER_ATTEMPTED_UPDATE_EMAIL = 'trigger-attempted-update-email';
export const TRIGGER_ATTEMPTED_READ_EMAIL = 'trigger-attempted-read-email';

@Injectable()
class TestUserService {
    constructor(private connection: TransactionalConnection) {}

    async createUser(ctx: RequestContext, identifier: string) {
        const authMethod = await this.connection.getRepository(ctx, NativeAuthenticationMethod).save(
            new NativeAuthenticationMethod({
                identifier,
                passwordHash: 'abc',
            }),
        );

        await this.connection.getRepository(ctx, User).insert(
            new User({
                authenticationMethods: [authMethod],
                identifier,
                roles: [],
                verified: true,
            }),
        );

        return this.connection.getRepository(ctx, User).findOne({
            where: { identifier },
        });
    }
}

@Injectable()
class TestAdminService {
    constructor(
        private connection: TransactionalConnection,
        private userService: TestUserService,
    ) {}

    async createAdministrator(ctx: RequestContext, emailAddress: string, fail: boolean) {
        const user = await this.userService.createUser(ctx, emailAddress);

        if (fail) {
            throw new InternalServerError('Failed!');
        }

        const admin = await this.connection.getRepository(ctx, Administrator).save(
            new Administrator({
                emailAddress,
                user,
                firstName: 'jim',
                lastName: 'jiminy',
            }),
        );
        return admin;
    }
}

@Resolver()
class TestResolver {
    constructor(
        private testAdminService: TestAdminService,
        private connection: TransactionalConnection,
        private eventBus: EventBus,
    ) {}

    @Mutation()
    @Transaction()
    async createTestAdministrator(@Ctx() ctx: RequestContext, @Args() args: any) {
        const admin = await this.testAdminService.createAdministrator(ctx, args.emailAddress, args.fail);
        await this.eventBus.publish(new TestEvent(ctx, admin));
        return admin;
    }

    @Mutation()
    @Transaction('manual')
    async createTestAdministrator2(@Ctx() ctx: RequestContext, @Args() args: any) {
        await this.connection.startTransaction(ctx);
        return this.testAdminService.createAdministrator(ctx, args.emailAddress, args.fail);
    }

    @Mutation()
    @Transaction('manual')
    async createTestAdministrator3(@Ctx() ctx: RequestContext, @Args() args: any) {
        // no transaction started
        return this.testAdminService.createAdministrator(ctx, args.emailAddress, args.fail);
    }

    @Mutation()
    @Transaction()
    async createTestAdministrator4(@Ctx() ctx: RequestContext, @Args() args: any) {
        const admin = await this.testAdminService.createAdministrator(ctx, args.emailAddress, args.fail);
        await this.eventBus.publish(new TestEvent(ctx, admin));
        await new Promise(resolve => setTimeout(resolve, 50));
        return admin;
    }

    @Mutation()
    async createTestAdministrator5(@Ctx() ctx: RequestContext, @Args() args: any) {
        if (args.noContext === true) {
            return this.connection.withTransaction(async _ctx => {
                const admin = await this.testAdminService.createAdministrator(
                    _ctx,
                    args.emailAddress,
                    args.fail,
                );
                return admin;
            });
        } else {
            return this.connection.withTransaction(ctx, async _ctx => {
                const admin = await this.testAdminService.createAdministrator(
                    _ctx,
                    args.emailAddress,
                    args.fail,
                );
                return admin;
            });
        }
    }

    @Mutation()
    @Transaction('manual')
    async createTestAdministrator6(@Ctx() ctx: RequestContext, @Args() args: any) {
        // Regression test for #4708:
        // In manual mode the TransactionInterceptor attaches a QueryRunner to the
        // ctx without starting a transaction on it. When an inner
        // `withTransaction(ctx, ...)` runs in this state, the buggy wrapper
        // committed and *released* that inherited QR — so any subsequent DB op
        // on the same ctx threw QueryRunnerAlreadyReleasedError. We intentionally
        // do NOT call `startTransaction` here so the inner wrapper hits the
        // BEGIN/COMMIT path (not a savepoint) and triggers the regression.
        const first = await this.connection.withTransaction(ctx, _ctx =>
            this.testAdminService.createAdministrator(_ctx, `${args.emailAddress}_a`, false),
        );
        const second = await this.testAdminService.createAdministrator(ctx, `${args.emailAddress}_b`, false);
        return first ?? second;
    }

    @Mutation()
    @Transaction()
    async createNTestAdministrators(@Ctx() ctx: RequestContext, @Args() args: any) {
        let error: any;

        const promises: Array<Promise<any>> = [];
        for (let i = 0; i < args.n; i++) {
            promises.push(
                new Promise(resolve => setTimeout(resolve, i * 10))
                    .then(() =>
                        this.testAdminService.createAdministrator(
                            ctx,
                            `${args.emailAddress}${i}`,
                            i < args.n * args.failFactor,
                        ),
                    )
                    .then(async admin => {
                        await this.eventBus.publish(new TestEvent(ctx, admin));
                        return admin;
                    }),
            );
        }

        const result = await Promise.all(promises).catch((e: any) => {
            error = e;
        });

        await this.allSettled(promises);

        if (error) {
            throw error;
        }

        return result;
    }

    @Mutation()
    async createNTestAdministrators2(@Ctx() ctx: RequestContext, @Args() args: any) {
        let error: any;

        const promises: Array<Promise<any>> = [];
        const result = await this.connection
            .withTransaction(ctx, _ctx => {
                for (let i = 0; i < args.n; i++) {
                    promises.push(
                        new Promise(resolve => setTimeout(resolve, i * 10)).then(() =>
                            this.testAdminService.createAdministrator(
                                _ctx,
                                `${args.emailAddress}${i}`,
                                i < args.n * args.failFactor,
                            ),
                        ),
                    );
                }

                return Promise.all(promises);
            })
            .catch((e: any) => {
                error = e;
            });

        await this.allSettled(promises);

        if (error) {
            throw error;
        }

        return result;
    }

    @Mutation()
    @Transaction()
    async createNTestAdministrators3(@Ctx() ctx: RequestContext, @Args() args: any) {
        const result: any[] = [];

        const admin = await this.testAdminService.createAdministrator(
            ctx,
            `${args.emailAddress}${args.n}`,
            args.failFactor >= 1,
        );

        result.push(admin);

        if (args.n > 0) {
            try {
                const admins = await this.connection.withTransaction(ctx, _ctx =>
                    this.createNTestAdministrators3(_ctx, {
                        ...args,
                        n: args.n - 1,
                        failFactor: (args.n * args.failFactor) / (args.n - 1),
                    }),
                );

                result.push(...admins);
            } catch (e) {
                /* */
            }
        }

        return result;
    }

    @Query()
    async verify() {
        const admins = await this.connection.getRepository(Administrator).find();
        const users = await this.connection.getRepository(User).find();
        return {
            admins,
            users,
        };
    }

    // Promise.allSettled polyfill
    // Same as Promise.all but waits until all promises will be fulfilled or rejected.
    private allSettled<T>(
        promises: Array<Promise<T>>,
    ): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: any }>> {
        return Promise.all(
            promises.map((promise, i) =>
                promise
                    .then(value => ({
                        status: 'fulfilled' as const,
                        value,
                    }))
                    .catch(reason => ({
                        status: 'rejected' as const,
                        reason,
                    })),
            ),
        );
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [TestAdminService, TestUserService],
    adminApiExtensions: {
        schema: gql`
            extend type Mutation {
                createTestAdministrator(emailAddress: String!, fail: Boolean!): Administrator
                createTestAdministrator2(emailAddress: String!, fail: Boolean!): Administrator
                createTestAdministrator3(emailAddress: String!, fail: Boolean!): Administrator
                createTestAdministrator4(emailAddress: String!, fail: Boolean!): Administrator
                createTestAdministrator5(
                    emailAddress: String!
                    fail: Boolean!
                    noContext: Boolean!
                ): Administrator
                createTestAdministrator6(emailAddress: String!): Administrator
                createNTestAdministrators(emailAddress: String!, failFactor: Float!, n: Int!): JSON
                createNTestAdministrators2(emailAddress: String!, failFactor: Float!, n: Int!): JSON
                createNTestAdministrators3(emailAddress: String!, failFactor: Float!, n: Int!): JSON
            }
            type VerifyResult {
                admins: [Administrator!]!
                users: [User!]!
            }
            extend type Query {
                verify: VerifyResult!
            }
        `,
        resolvers: [TestResolver],
    },
})
export class TransactionTestPlugin implements OnApplicationBootstrap {
    private subscription: Subscription;
    static callHandler = vi.fn();
    static errorHandler = vi.fn();
    static eventHandlerComplete$ = new ReplaySubject(1);

    constructor(
        private eventBus: EventBus,
        private connection: TransactionalConnection,
    ) {}

    static reset() {
        this.eventHandlerComplete$ = new ReplaySubject(1);
        this.callHandler.mockClear();
        this.errorHandler.mockClear();
    }

    onApplicationBootstrap(): any {
        // This part is used to test how RequestContext with transactions behave
        // when used in an Event subscription
        this.subscription = this.eventBus.ofType(TestEvent).subscribe(async event => {
            const { ctx, administrator } = event;

            if (administrator.emailAddress?.includes(TRIGGER_NO_OPERATION)) {
                TransactionTestPlugin.callHandler();
                TransactionTestPlugin.eventHandlerComplete$.complete();
            }
            if (administrator.emailAddress?.includes(TRIGGER_ATTEMPTED_UPDATE_EMAIL)) {
                TransactionTestPlugin.callHandler();
                const adminRepository = this.connection.getRepository(ctx, Administrator);
                await new Promise(resolve => setTimeout(resolve, 50));
                administrator.lastName = 'modified';
                try {
                    await adminRepository.save(administrator);
                } catch (e: any) {
                    TransactionTestPlugin.errorHandler(e);
                } finally {
                    TransactionTestPlugin.eventHandlerComplete$.complete();
                }
            }
            if (administrator.emailAddress?.includes(TRIGGER_ATTEMPTED_READ_EMAIL)) {
                TransactionTestPlugin.callHandler();
                // note the ctx is not passed here, so we are not inside the ongoing transaction
                const adminRepository = this.connection.getRepository(Administrator);
                try {
                    await adminRepository.findOneOrFail({ where: { id: administrator.id } });
                } catch (e: any) {
                    TransactionTestPlugin.errorHandler(e);
                } finally {
                    TransactionTestPlugin.eventHandlerComplete$.complete();
                }
            }
        });
    }
}
