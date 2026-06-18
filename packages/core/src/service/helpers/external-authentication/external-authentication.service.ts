import { Injectable } from '@nestjs/common';
import { HistoryEntryType } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../../api/common/request-context';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Administrator } from '../../../entity/administrator/administrator.entity';
import { ExternalAuthenticationMethod } from '../../../entity/authentication-method/external-authentication-method.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { Role } from '../../../entity/role/role.entity';
import { User } from '../../../entity/user/user.entity';
import { AdministratorService } from '../../services/administrator.service';
import { ChannelService } from '../../services/channel.service';
import { CustomerService } from '../../services/customer.service';
import { HistoryService } from '../../services/history.service';
import { RoleService } from '../../services/role.service';

/**
 * @description
 * This is a helper service which exposes methods related to looking up and creating Users based on an
 * external {@link AuthenticationStrategy}.
 *
 * @docsCategory auth
 */
@Injectable()
export class ExternalAuthenticationService {
    constructor(
        private connection: TransactionalConnection,
        private roleService: RoleService,
        private historyService: HistoryService,
        private customerService: CustomerService,
        private administratorService: AdministratorService,
        private channelService: ChannelService,
    ) {}

    /**
     * @description
     * Looks up a User based on their identifier from an external authentication
     * provider, ensuring this User is associated with a Customer account.
     *
     * By default, only customers in the currently-active Channel will be checked.
     * By passing `false` as the `checkCurrentChannelOnly` argument, _all_ channels
     * will be checked.
     */
    async findCustomerUser(
        ctx: RequestContext,
        strategy: string,
        externalIdentifier: string,
        checkCurrentChannelOnly = true,
    ): Promise<User | undefined> {
        const user = await this.findUser(ctx, strategy, externalIdentifier);

        if (user) {
            // Ensure this User is associated with a Customer
            const customer = await this.customerService.findOneByUserId(
                ctx,
                user.id,
                checkCurrentChannelOnly,
            );
            if (customer) {
                return user;
            }
        }
    }

    /**
     * @description
     * Looks up a User based on their identifier from an external authentication
     * provider, ensuring this User is associated with an Administrator account.
     */
    async findAdministratorUser(
        ctx: RequestContext,
        strategy: string,
        externalIdentifier: string,
    ): Promise<User | undefined> {
        const user = await this.findUser(ctx, strategy, externalIdentifier);
        if (user) {
            // Ensure this User is associated with an Administrator
            const administrator = await this.administratorService.findOneByUserId(ctx, user.id);
            if (administrator) {
                return user;
            }
        }
    }

    /**
     * @description
     * If a customer has been successfully authenticated by an external authentication provider, yet cannot
     * be found using `findCustomerUser`, then we need to create a new User and
     * Customer record in Vendure for that user. This method encapsulates that logic as well as additional
     * housekeeping such as adding a record to the Customer's history.
     */
    async createCustomerAndUser(
        ctx: RequestContext,
        config: {
            strategy: string;
            externalIdentifier: string;
            emailAddress: string;
            firstName: string;
            lastName: string;
            verified?: boolean;
        },
    ): Promise<User> {
        let user: User;

        const existingUser = await this.findExistingCustomerUserByEmailAddress(ctx, config.emailAddress);

        if (existingUser) {
            user = existingUser;
        } else {
            const customerRole = await this.roleService.getCustomerRole(ctx);
            user = new User({
                identifier: config.emailAddress,
                roles: [customerRole],
                verified: config.verified || false,
                authenticationMethods: [],
            });
        }
        const authMethod = await this.connection.getRepository(ctx, ExternalAuthenticationMethod).save(
            new ExternalAuthenticationMethod({
                externalIdentifier: config.externalIdentifier,
                strategy: config.strategy,
            }),
        );

        user.authenticationMethods = [...(user.authenticationMethods || []), authMethod];
        const savedUser = await this.connection.getRepository(ctx, User).save(user);

        let customer: Customer;
        const existingCustomer = await this.customerService.findOneByUserId(ctx, savedUser.id);
        if (existingCustomer) {
            customer = existingCustomer;
        } else {
            customer = new Customer({
                emailAddress: config.emailAddress,
                firstName: config.firstName,
                lastName: config.lastName,
                user: savedUser,
            });
        }
        await this.channelService.assignToCurrentChannel(customer, ctx);
        await this.connection.getRepository(ctx, Customer).save(customer);

        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_REGISTERED,
            data: {
                strategy: config.strategy,
            },
        });

        if (config.verified) {
            await this.historyService.createHistoryEntryForCustomer({
                customerId: customer.id,
                ctx,
                type: HistoryEntryType.CUSTOMER_VERIFIED,
                data: {
                    strategy: config.strategy,
                },
            });
        }

        return savedUser;
    }

    /**
     * @description
     * If an administrator has been successfully authenticated by an external authentication provider, yet cannot
     * be found using `findAdministratorUser`, then we need to create a new User and
     * Administrator record in Vendure for that user.
     */
    async createAdministratorAndUser(
        ctx: RequestContext,
        config: {
            strategy: string;
            externalIdentifier: string;
            identifier: string;
            emailAddress?: string;
            firstName?: string;
            lastName?: string;
            roles: Role[];
        },
    ) {
        const newUser = new User({
            identifier: config.identifier,
            roles: config.roles,
            verified: true,
        });

        const authMethod = await this.connection.getRepository(ctx, ExternalAuthenticationMethod).save(
            new ExternalAuthenticationMethod({
                externalIdentifier: config.externalIdentifier,
                strategy: config.strategy,
            }),
        );

        newUser.authenticationMethods = [authMethod];
        const savedUser = await this.connection.getRepository(ctx, User).save(newUser);

        const administrator = await this.connection.getRepository(ctx, Administrator).save(
            new Administrator({
                emailAddress: config.emailAddress,
                firstName: config.firstName,
                lastName: config.lastName,
                user: savedUser,
            }),
        );

        return savedUser;
    }

    async findUser(
        ctx: RequestContext,
        strategy: string,
        externalIdentifier: string,
    ): Promise<User | undefined> {
        const user = await this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.authenticationMethods', 'aums')
            .leftJoin('user.authenticationMethods', 'authMethod')
            .andWhere('authMethod.externalIdentifier = :externalIdentifier', { externalIdentifier })
            .andWhere('authMethod.strategy = :strategy', { strategy })
            .andWhere('user.deletedAt IS NULL')
            .getOne();
        return user || undefined;
    }

    private async findExistingCustomerUserByEmailAddress(ctx: RequestContext, emailAddress: string) {
        const customer = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .leftJoinAndSelect('customer.user', 'user')
            .leftJoin('customer.channels', 'channel')
            .leftJoinAndSelect('user.authenticationMethods', 'authMethod')
            .andWhere('customer.emailAddress = :emailAddress', { emailAddress })
            .andWhere('user.deletedAt IS NULL')
            .getOne();

        return customer?.user;
    }

    /**
     * @description
     * Looks up a User based on their identifier from an external authentication
     * provider. Creates the user if does not exist. Unlike `findCustomerUser` and `findAdministratorUser`,
     * this method does not enforce that the User is associated with a Customer or
     * Administrator account.
     *
     */
    async createUser(
        ctx: RequestContext,
        config: {
            strategy: string;
            externalIdentifier: string;
        },
    ): Promise<User> {
        const user = await this.findUser(ctx, config.strategy, config.externalIdentifier);
        if (user) {
            return user;
        }
        const newUser = new User();
        const authMethod = await this.connection.getRepository(ctx, ExternalAuthenticationMethod).save(
            new ExternalAuthenticationMethod({
                externalIdentifier: config.externalIdentifier,
                strategy: config.strategy,
            }),
        );
        newUser.identifier = config.externalIdentifier;
        newUser.authenticationMethods = [authMethod];
        const savedUser = await this.connection.getRepository(ctx, User).save(newUser);
        return savedUser;
    }
}
