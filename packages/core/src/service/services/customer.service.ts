import { Injectable } from '@nestjs/common';
import {
    RegisterCustomerAccountResult,
    RegisterCustomerInput,
    UpdateCustomerInput as UpdateCustomerShopInput,
    VerifyCustomerAccountResult,
} from '@vendure/common/lib/generated-shop-types';
import {
    AddNoteToCustomerInput,
    CreateAddressInput,
    CreateCustomerInput,
    CreateCustomerResult,
    CustomerFilterParameter,
    DeletionResponse,
    DeletionResult,
    HistoryEntryType,
    OrderAddress,
    UpdateAddressInput,
    UpdateCustomerInput,
    UpdateCustomerNoteInput,
    UpdateCustomerResult,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { ErrorResultUnion, isGraphQlErrorResult } from '../../common/error/error-result';
import { EntityNotFoundError, InternalServerError } from '../../common/error/errors';
import { EmailAddressConflictError as EmailAddressConflictAdminError } from '../../common/error/generated-graphql-admin-errors';
import {
    EmailAddressConflictError,
    IdentifierChangeTokenExpiredError,
    IdentifierChangeTokenInvalidError,
    MissingPasswordError,
    PasswordResetTokenExpiredError,
    PasswordResetTokenInvalidError,
    PasswordValidationError,
} from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual, normalizeEmailAddress } from '../../common/utils';
import { NATIVE_AUTH_STRATEGY_NAME } from '../../config/auth/native-authentication-strategy';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Address } from '../../entity/address/address.entity';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { CustomerGroup } from '../../entity/customer-group/customer-group.entity';
import { Customer } from '../../entity/customer/customer.entity';
import { HistoryEntry } from '../../entity/history-entry/history-entry.entity';
import { Order } from '../../entity/order/order.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus/event-bus';
import { AccountRegistrationEvent } from '../../event-bus/events/account-registration-event';
import { AccountVerifiedEvent } from '../../event-bus/events/account-verified-event';
import { CustomerAddressEvent } from '../../event-bus/events/customer-address-event';
import { CustomerEvent } from '../../event-bus/events/customer-event';
import { IdentifierChangeEvent } from '../../event-bus/events/identifier-change-event';
import { IdentifierChangeRequestEvent } from '../../event-bus/events/identifier-change-request-event';
import { PasswordResetEvent } from '../../event-bus/events/password-reset-event';
import { PasswordResetVerifiedEvent } from '../../event-bus/events/password-reset-verified-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatorService } from '../helpers/translator/translator.service';
import { addressToLine } from '../helpers/utils/address-to-line';
import { patchEntity } from '../helpers/utils/patch-entity';

import { ChannelService } from './channel.service';
import { CountryService } from './country.service';
import { HistoryService } from './history.service';
import { UserService } from './user.service';

/**
 * @description
 * Contains methods relating to {@link Customer} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class CustomerService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private userService: UserService,
        private countryService: CountryService,
        private listQueryBuilder: ListQueryBuilder,
        private eventBus: EventBus,
        private historyService: HistoryService,
        private channelService: ChannelService,
        private customFieldRelationService: CustomFieldRelationService,
        private translator: TranslatorService,
    ) {}

    findAll(
        ctx: RequestContext,
        options: ListQueryOptions<Customer> | undefined,
        relations: RelationPaths<Customer> = [],
    ): Promise<PaginatedList<Customer>> {
        const customPropertyMap: { [name: string]: string } = {};
        const hasPostalCodeFilter = this.listQueryBuilder.filterObjectHasProperty<CustomerFilterParameter>(
            options?.filter,
            'postalCode',
        );
        if (hasPostalCodeFilter) {
            relations.push('addresses');
            customPropertyMap.postalCode = 'addresses.postalCode';
        }
        return this.listQueryBuilder
            .build(Customer, options, {
                relations,
                channelId: ctx.channelId,
                where: { deletedAt: IsNull() },
                ctx,
                customPropertyMap,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    findOne(
        ctx: RequestContext,
        id: ID,
        relations: RelationPaths<Customer> = [],
    ): Promise<Customer | undefined> {
        return this.connection
            .findOneInChannel(ctx, Customer, id, ctx.channelId, {
                relations,
                where: { deletedAt: IsNull() },
            })
            .then(result => result ?? undefined);
    }

    /**
     * @description
     * Returns the Customer entity associated with the given userId, if one exists.
     * Setting `filterOnChannel` to `true` will limit the results to Customers which are assigned
     * to the current active Channel only.
     */
    findOneByUserId(ctx: RequestContext, userId: ID, filterOnChannel = true): Promise<Customer | undefined> {
        let query = this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .leftJoin('customer.channels', 'channel')
            .leftJoinAndSelect('customer.user', 'user')
            .where('user.id = :userId', { userId })
            .andWhere('customer.deletedAt is null');
        if (filterOnChannel) {
            query = query.andWhere('channel.id = :channelId', { channelId: ctx.channelId });
        }
        return query.getOne().then(result => result ?? undefined);
    }

    /**
     * @description
     * Returns all {@link Address} entities associated with the specified Customer.
     */
    findAddressesByCustomerId(ctx: RequestContext, customerId: ID): Promise<Address[]> {
        return this.connection
            .getRepository(ctx, Address)
            .createQueryBuilder('address')
            .leftJoinAndSelect('address.country', 'country')
            .leftJoinAndSelect('country.translations', 'countryTranslation')
            .where('address.customer = :id', { id: customerId })
            .getMany()
            .then(addresses => {
                addresses.forEach(address => {
                    address.country = this.translator.translate(address.country, ctx);
                });
                return addresses;
            });
    }

    /**
     * @description
     * Returns a list of all {@link CustomerGroup} entities.
     */
    async getCustomerGroups(ctx: RequestContext, customerId: ID): Promise<CustomerGroup[]> {
        const customerWithGroups = await this.connection.findOneInChannel(
            ctx,
            Customer,
            customerId,
            ctx?.channelId,
            {
                relations: ['groups'],
                where: {
                    deletedAt: IsNull(),
                },
            },
        );
        if (customerWithGroups) {
            return customerWithGroups.groups;
        } else {
            return [];
        }
    }

    /**
     * @description
     * Creates a new Customer, including creation of a new User with the special `customer` Role.
     *
     * If the `password` argument is specified, the Customer will be immediately verified. If not,
     * then an {@link AccountRegistrationEvent} is published, so that the customer can have their
     * email address verified and set their password in a later step using the `verifyCustomerEmailAddress()`
     * method.
     *
     * This method is intended to be used in admin-created Customer flows.
     */
    async create(
        ctx: RequestContext,
        input: CreateCustomerInput,
        password?: string,
    ): Promise<ErrorResultUnion<CreateCustomerResult, Customer>> {
        input.emailAddress = normalizeEmailAddress(input.emailAddress);
        const customer = new Customer(input);

        const existingCustomerInChannel = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .leftJoin('customer.channels', 'channel')
            .where('channel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('customer.emailAddress = :emailAddress', { emailAddress: input.emailAddress })
            .andWhere('customer.deletedAt is null')
            .getOne();

        if (existingCustomerInChannel) {
            return new EmailAddressConflictAdminError();
        }

        const existingCustomer = await this.connection.getRepository(ctx, Customer).findOne({
            relations: ['channels'],
            where: {
                emailAddress: input.emailAddress,
                deletedAt: IsNull(),
            },
        });
        const existingUser = await this.userService.getUserByEmailAddress(
            ctx,
            input.emailAddress,
            'customer',
        );

        if (existingCustomer && existingUser) {
            // Customer already exists, bring to this Channel
            const updatedCustomer = patchEntity(existingCustomer, input);
            updatedCustomer.channels.push(ctx.channel);
            return this.connection.getRepository(ctx, Customer).save(updatedCustomer);
        } else if (existingCustomer || existingUser) {
            // Not sure when this situation would occur
            return new EmailAddressConflictAdminError();
        }
        const customerUser = await this.userService.createCustomerUser(ctx, input.emailAddress, password);
        if (isGraphQlErrorResult(customerUser)) {
            throw customerUser;
        }
        customer.user = customerUser;

        if (password && password !== '') {
            const verificationToken = customer.user.getNativeAuthenticationMethod().verificationToken;
            if (verificationToken) {
                const result = await this.userService.verifyUserByToken(ctx, verificationToken);
                if (isGraphQlErrorResult(result)) {
                    // In theory this should never be reached, so we will just
                    // throw the result
                    throw result;
                } else {
                    customer.user = result;
                }
            }
        }
        await this.eventBus.publish(new AccountRegistrationEvent(ctx, customer.user));
        await this.channelService.assignToCurrentChannel(customer, ctx);
        const createdCustomer = await this.connection.getRepository(ctx, Customer).save(customer);
        await this.customFieldRelationService.updateRelations(ctx, Customer, input, createdCustomer);
        await this.historyService.createHistoryEntryForCustomer({
            ctx,
            customerId: createdCustomer.id,
            type: HistoryEntryType.CUSTOMER_REGISTERED,
            data: {
                strategy: NATIVE_AUTH_STRATEGY_NAME,
            },
        });

        if (customer.user?.verified) {
            await this.historyService.createHistoryEntryForCustomer({
                ctx,
                customerId: createdCustomer.id,
                type: HistoryEntryType.CUSTOMER_VERIFIED,
                data: {
                    strategy: NATIVE_AUTH_STRATEGY_NAME,
                },
            });
        }
        await this.eventBus.publish(new CustomerEvent(ctx, createdCustomer, 'created', input));
        return createdCustomer;
    }

    async update(ctx: RequestContext, input: UpdateCustomerShopInput & { id: ID }): Promise<Customer>;
    async update(
        ctx: RequestContext,
        input: UpdateCustomerInput,
    ): Promise<ErrorResultUnion<UpdateCustomerResult, Customer>>;
    async update(
        ctx: RequestContext,
        input: UpdateCustomerInput | (UpdateCustomerShopInput & { id: ID }),
    ): Promise<ErrorResultUnion<UpdateCustomerResult, Customer>> {
        const hasEmailAddress = (i: any): i is UpdateCustomerInput & { emailAddress: string } =>
            Object.hasOwnProperty.call(i, 'emailAddress');

        const customer = await this.connection.getEntityOrThrow(ctx, Customer, input.id, {
            channelId: ctx.channelId,
        });

        if (hasEmailAddress(input)) {
            input.emailAddress = normalizeEmailAddress(input.emailAddress);
            if (input.emailAddress !== customer.emailAddress) {
                const existingCustomerInChannel = await this.connection
                    .getRepository(ctx, Customer)
                    .createQueryBuilder('customer')
                    .leftJoin('customer.channels', 'channel')
                    .where('channel.id = :channelId', { channelId: ctx.channelId })
                    .andWhere('customer.emailAddress = :emailAddress', {
                        emailAddress: input.emailAddress,
                    })
                    .andWhere('customer.id != :customerId', { customerId: input.id })
                    .andWhere('customer.deletedAt is null')
                    .getOne();

                if (existingCustomerInChannel) {
                    return new EmailAddressConflictAdminError();
                }

                if (customer.user) {
                    const existingUserWithEmailAddress = await this.userService.getUserByEmailAddress(
                        ctx,
                        input.emailAddress,
                        'customer',
                    );

                    if (
                        existingUserWithEmailAddress &&
                        !idsAreEqual(customer.user.id, existingUserWithEmailAddress.id)
                    ) {
                        return new EmailAddressConflictAdminError();
                    }

                    await this.userService.changeUserAndNativeIdentifier(
                        ctx,
                        customer.user.id,
                        input.emailAddress,
                    );
                }
            }
        }

        const updatedCustomer = patchEntity(customer, input);
        await this.connection.getRepository(ctx, Customer).save(updatedCustomer, { reload: false });
        await this.customFieldRelationService.updateRelations(ctx, Customer, input, updatedCustomer);
        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_DETAIL_UPDATED,
            data: {
                input,
            },
        });
        await this.eventBus.publish(new CustomerEvent(ctx, customer, 'updated', input));
        return assertFound(this.findOne(ctx, customer.id));
    }

    /**
     * @description
     * Registers a new Customer account with the {@link NativeAuthenticationStrategy} and starts
     * the email verification flow (unless {@link AuthOptions} `requireVerification` is set to `false`)
     * by publishing an {@link AccountRegistrationEvent}.
     *
     * This method is intended to be used in storefront Customer-creation flows.
     */
    async registerCustomerAccount(
        ctx: RequestContext,
        input: RegisterCustomerInput,
    ): Promise<RegisterCustomerAccountResult | EmailAddressConflictError | PasswordValidationError> {
        if (!this.configService.authOptions.requireVerification) {
            if (!input.password) {
                return new MissingPasswordError();
            }
        }
        let user = await this.userService.getUserByEmailAddress(ctx, input.emailAddress);
        const hasNativeAuthMethod = !!user?.authenticationMethods.find(
            m => m instanceof NativeAuthenticationMethod,
        );
        if (user && user.verified) {
            if (hasNativeAuthMethod) {
                // If the user has already been verified and has already
                // registered with the native authentication strategy, do nothing.
                return { success: true };
            }
        }
        const customFields = (input as any).customFields;
        const customer = await this.createOrUpdate(ctx, {
            emailAddress: input.emailAddress,
            title: input.title || '',
            firstName: input.firstName || '',
            lastName: input.lastName || '',
            phoneNumber: input.phoneNumber || '',
            ...(customFields ? { customFields } : {}),
        });
        if (isGraphQlErrorResult(customer)) {
            return customer;
        }
        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_REGISTERED,
            data: {
                strategy: NATIVE_AUTH_STRATEGY_NAME,
            },
        });
        if (!user) {
            const customerUser = await this.userService.createCustomerUser(
                ctx,
                input.emailAddress,
                input.password || undefined,
            );
            if (isGraphQlErrorResult(customerUser)) {
                return customerUser;
            } else {
                user = customerUser;
            }
        }
        if (!hasNativeAuthMethod) {
            const addAuthenticationResult = await this.userService.addNativeAuthenticationMethod(
                ctx,
                user,
                input.emailAddress,
                input.password || undefined,
            );
            if (isGraphQlErrorResult(addAuthenticationResult)) {
                return addAuthenticationResult;
            } else {
                user = addAuthenticationResult;
            }
        }
        if (!user.verified) {
            user = await this.userService.setVerificationToken(ctx, user);
        }

        customer.user = user;
        await this.connection.getRepository(ctx, User).save(user, { reload: false });
        await this.connection.getRepository(ctx, Customer).save(customer, { reload: false });
        if (!user.verified) {
            await this.eventBus.publish(new AccountRegistrationEvent(ctx, user));
        } else {
            await this.historyService.createHistoryEntryForCustomer({
                customerId: customer.id,
                ctx,
                type: HistoryEntryType.CUSTOMER_VERIFIED,
                data: {
                    strategy: NATIVE_AUTH_STRATEGY_NAME,
                },
            });
        }
        return { success: true };
    }

    /**
     * @description
     * Refreshes a stale email address verification token by generating a new one and
     * publishing a {@link AccountRegistrationEvent}.
     */
    async refreshVerificationToken(ctx: RequestContext, emailAddress: string): Promise<void> {
        const user = await this.userService.getUserByEmailAddress(ctx, emailAddress);
        if (user && !user.verified) {
            await this.userService.setVerificationToken(ctx, user);
            await this.eventBus.publish(new AccountRegistrationEvent(ctx, user));
        }
    }

    /**
     * @description
     * Given a valid verification token which has been published in an {@link AccountRegistrationEvent}, this
     * method is used to set the Customer as `verified` as part of the account registration flow.
     */
    async verifyCustomerEmailAddress(
        ctx: RequestContext,
        verificationToken: string,
        password?: string,
    ): Promise<ErrorResultUnion<VerifyCustomerAccountResult, Customer>> {
        const result = await this.userService.verifyUserByToken(ctx, verificationToken, password);
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        const customer = await this.findOneByUserId(ctx, result.id, false);
        if (!customer) {
            throw new InternalServerError('error.cannot-locate-customer-for-user');
        }
        if (ctx.channelId) {
            await this.channelService.assignToChannels(ctx, Customer, customer.id, [ctx.channelId]);
        }
        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_VERIFIED,
            data: {
                strategy: NATIVE_AUTH_STRATEGY_NAME,
            },
        });
        const user = assertFound(this.findOneByUserId(ctx, result.id));
        await this.eventBus.publish(new AccountVerifiedEvent(ctx, customer));
        return user;
    }

    /**
     * @description
     * Publishes a new {@link PasswordResetEvent} for the given email address. This event creates
     * a token which can be used in the `resetPassword()` method.
     */
    async requestPasswordReset(ctx: RequestContext, emailAddress: string): Promise<void> {
        const user = await this.userService.setPasswordResetToken(ctx, emailAddress);
        if (user) {
            await this.eventBus.publish(new PasswordResetEvent(ctx, user));
            const customer = await this.findOneByUserId(ctx, user.id);
            if (!customer) {
                throw new InternalServerError('error.cannot-locate-customer-for-user');
            }
            await this.historyService.createHistoryEntryForCustomer({
                customerId: customer.id,
                ctx,
                type: HistoryEntryType.CUSTOMER_PASSWORD_RESET_REQUESTED,
                data: {},
            });
        }
    }

    /**
     * @description
     * Given a valid password reset token created by a call to the `requestPasswordReset()` method,
     * this method will change the Customer's password to that given as the `password` argument.
     */
    async resetPassword(
        ctx: RequestContext,
        passwordResetToken: string,
        password: string,
    ): Promise<
        User | PasswordResetTokenExpiredError | PasswordResetTokenInvalidError | PasswordValidationError
    > {
        const result = await this.userService.resetPasswordByToken(ctx, passwordResetToken, password);
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        const customer = await this.findOneByUserId(ctx, result.id);
        if (!customer) {
            throw new InternalServerError('error.cannot-locate-customer-for-user');
        }
        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_PASSWORD_RESET_VERIFIED,
            data: {},
        });
        await this.eventBus.publish(new PasswordResetVerifiedEvent(ctx, result));
        return result;
    }

    /**
     * @description
     * Publishes a {@link IdentifierChangeRequestEvent} for the given User. This event contains a token
     * which is then used in the `updateEmailAddress()` method to change the email address of the User &
     * Customer.
     */
    async requestUpdateEmailAddress(
        ctx: RequestContext,
        userId: ID,
        newEmailAddress: string,
    ): Promise<boolean | EmailAddressConflictError> {
        const normalizedEmailAddress = normalizeEmailAddress(newEmailAddress);
        const userWithConflictingIdentifier = await this.userService.getUserByEmailAddress(
            ctx,
            newEmailAddress,
        );
        if (userWithConflictingIdentifier) {
            return new EmailAddressConflictError();
        }
        const user = await this.userService.getUserById(ctx, userId);
        if (!user) {
            return false;
        }
        const customer = await this.findOneByUserId(ctx, user.id);
        if (!customer) {
            return false;
        }
        const oldEmailAddress = customer.emailAddress;
        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_EMAIL_UPDATE_REQUESTED,
            data: {
                oldEmailAddress,
                newEmailAddress: normalizedEmailAddress,
            },
        });
        if (this.configService.authOptions.requireVerification) {
            user.getNativeAuthenticationMethod().pendingIdentifier = normalizedEmailAddress;
            await this.userService.setIdentifierChangeToken(ctx, user);
            await this.eventBus.publish(new IdentifierChangeRequestEvent(ctx, user));
            return true;
        } else {
            const oldIdentifier = user.identifier;
            user.identifier = normalizedEmailAddress;
            customer.emailAddress = normalizedEmailAddress;
            await this.connection.getRepository(ctx, User).save(user, { reload: false });
            await this.connection.getRepository(ctx, Customer).save(customer, { reload: false });
            await this.eventBus.publish(new IdentifierChangeEvent(ctx, user, oldIdentifier));
            await this.historyService.createHistoryEntryForCustomer({
                customerId: customer.id,
                ctx,
                type: HistoryEntryType.CUSTOMER_EMAIL_UPDATE_VERIFIED,
                data: {
                    oldEmailAddress,
                    newEmailAddress: normalizedEmailAddress,
                },
            });
            return true;
        }
    }

    /**
     * @description
     * Given a valid email update token published in a {@link IdentifierChangeRequestEvent}, this method
     * will update the Customer & User email address.
     */
    async updateEmailAddress(
        ctx: RequestContext,
        token: string,
    ): Promise<boolean | IdentifierChangeTokenInvalidError | IdentifierChangeTokenExpiredError> {
        const result = await this.userService.changeIdentifierByToken(ctx, token);
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        const { user, oldIdentifier } = result;
        if (!user) {
            return false;
        }
        const customer = await this.findOneByUserId(ctx, user.id);
        if (!customer) {
            return false;
        }
        await this.eventBus.publish(new IdentifierChangeEvent(ctx, user, oldIdentifier));
        customer.emailAddress = user.identifier;
        await this.connection.getRepository(ctx, Customer).save(customer, { reload: false });
        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_EMAIL_UPDATE_VERIFIED,
            data: {
                oldEmailAddress: oldIdentifier,
                newEmailAddress: customer.emailAddress,
            },
        });
        return true;
    }

    /**
     * @description
     * For guest checkouts, we assume that a matching email address is the same customer.
     */
    async createOrUpdate(
        ctx: RequestContext,
        input: Partial<CreateCustomerInput> & { emailAddress: string },
        errorOnExistingUser: boolean = false,
    ): Promise<Customer | EmailAddressConflictError> {
        input.emailAddress = normalizeEmailAddress(input.emailAddress);
        let customer: Customer;
        const existing = await this.connection.getRepository(ctx, Customer).findOne({
            relations: ['channels'],
            where: {
                emailAddress: input.emailAddress,
                deletedAt: IsNull(),
            },
        });
        if (existing) {
            if (existing.user && errorOnExistingUser) {
                // It is not permitted to modify an existing *registered* Customer
                return new EmailAddressConflictError();
            }
            customer = patchEntity(existing, input);
            customer.channels.push(await this.connection.getEntityOrThrow(ctx, Channel, ctx.channelId));
        } else {
            customer = await this.connection.getRepository(ctx, Customer).save(new Customer(input));
            await this.channelService.assignToCurrentChannel(customer, ctx);
            await this.eventBus.publish(new CustomerEvent(ctx, customer, 'created', input));
        }
        return this.connection.getRepository(ctx, Customer).save(customer);
    }

    /**
     * @description
     * Creates a new {@link Address} for the given Customer.
     */
    async createAddress(ctx: RequestContext, customerId: ID, input: CreateAddressInput): Promise<Address> {
        const customer = await this.connection.getEntityOrThrow(ctx, Customer, customerId, {
            where: { deletedAt: IsNull() },
            relations: ['addresses'],
            channelId: ctx.channelId,
        });

        const country = await this.countryService.findOneByCode(ctx, input.countryCode);
        const address = new Address({
            ...input,
            country,
        });
        const createdAddress = await this.connection.getRepository(ctx, Address).save(address);
        await this.customFieldRelationService.updateRelations(ctx, Address, input, createdAddress);
        customer.addresses.push(createdAddress);
        await this.connection.getRepository(ctx, Customer).save(customer, { reload: false });
        await this.enforceSingleDefaultAddress(ctx, createdAddress.id, input);
        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_ADDRESS_CREATED,
            data: { address: addressToLine(createdAddress) },
        });
        createdAddress.customer = customer;
        await this.eventBus.publish(new CustomerAddressEvent(ctx, createdAddress, 'created', input));
        return createdAddress;
    }

    async updateAddress(ctx: RequestContext, input: UpdateAddressInput): Promise<Address> {
        const address = await this.connection.getEntityOrThrow(ctx, Address, input.id, {
            relations: ['customer', 'country'],
        });
        const customer = await this.connection.findOneInChannel<Customer>(
            ctx,
            Customer,
            address.customer.id,
            ctx.channelId,
        );
        if (!customer) {
            throw new EntityNotFoundError('Address', input.id);
        }
        if (input.countryCode && input.countryCode !== address.country.code) {
            address.country = await this.countryService.findOneByCode(ctx, input.countryCode);
        } else {
            address.country = this.translator.translate(address.country, ctx);
        }
        let updatedAddress = patchEntity(address, input);
        updatedAddress = await this.connection.getRepository(ctx, Address).save(updatedAddress);
        await this.customFieldRelationService.updateRelations(ctx, Address, input, updatedAddress);
        await this.enforceSingleDefaultAddress(ctx, input.id, input);

        await this.historyService.createHistoryEntryForCustomer({
            customerId: address.customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_ADDRESS_UPDATED,
            data: {
                address: addressToLine(updatedAddress),
                input,
            },
        });
        updatedAddress.customer = customer;
        await this.eventBus.publish(new CustomerAddressEvent(ctx, updatedAddress, 'updated', input));
        return updatedAddress;
    }

    async deleteAddress(ctx: RequestContext, id: ID): Promise<boolean> {
        const address = await this.connection.getEntityOrThrow(ctx, Address, id, {
            relations: ['customer', 'country'],
        });
        const customer = await this.connection.findOneInChannel(
            ctx,
            Customer,
            address.customer.id,
            ctx.channelId,
        );
        if (!customer) {
            throw new EntityNotFoundError('Address', id);
        }
        address.country = this.translator.translate(address.country, ctx);
        await this.reassignDefaultsForDeletedAddress(ctx, address);
        await this.historyService.createHistoryEntryForCustomer({
            customerId: address.customer.id,
            ctx,
            type: HistoryEntryType.CUSTOMER_ADDRESS_DELETED,
            data: {
                address: addressToLine(address),
            },
        });
        const deletedAddress = new Address(address);
        await this.connection.getRepository(ctx, Address).remove(address);
        address.customer = customer;
        await this.eventBus.publish(new CustomerAddressEvent(ctx, deletedAddress, 'deleted', id));
        return true;
    }

    async softDelete(ctx: RequestContext, customerId: ID): Promise<DeletionResponse> {
        const customer = await this.connection.getEntityOrThrow(ctx, Customer, customerId, {
            channelId: ctx.channelId,
        });
        await this.connection
            .getRepository(ctx, Customer)
            .update({ id: customerId }, { deletedAt: new Date() });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (customer.user) {
            await this.userService.softDelete(ctx, customer.user.id);
        }
        await this.eventBus.publish(new CustomerEvent(ctx, customer, 'deleted', customerId));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * @description
     * If the Customer associated with the given Order does not yet have any Addresses,
     * this method will create new Address(es) based on the Order's shipping & billing
     * addresses.
     */
    async createAddressesForNewCustomer(ctx: RequestContext, order: Order) {
        if (!order.customer) {
            return;
        }
        const addresses = await this.findAddressesByCustomerId(ctx, order.customer.id);
        // If the Customer has no addresses yet, use the shipping/billing address data
        // to populate the initial default Address.
        if (addresses.length === 0 && order.shippingAddress?.country) {
            const shippingAddress = order.shippingAddress;
            const billingAddress = order.billingAddress;
            const hasSeparateBillingAddress =
                billingAddress?.streetLine1 && !this.addressesAreEqual(shippingAddress, billingAddress);
            if (shippingAddress.streetLine1) {
                await this.createAddress(ctx, order.customer.id, {
                    ...shippingAddress,
                    company: shippingAddress.company || '',
                    streetLine1: shippingAddress.streetLine1 || '',
                    streetLine2: shippingAddress.streetLine2 || '',
                    countryCode: shippingAddress.countryCode || '',
                    defaultBillingAddress: !hasSeparateBillingAddress,
                    defaultShippingAddress: true,
                });
            }
            if (hasSeparateBillingAddress) {
                await this.createAddress(ctx, order.customer.id, {
                    ...billingAddress,
                    company: billingAddress.company || '',
                    streetLine1: billingAddress.streetLine1 || '',
                    streetLine2: billingAddress.streetLine2 || '',
                    countryCode: billingAddress.countryCode || '',
                    defaultBillingAddress: true,
                    defaultShippingAddress: false,
                });
            }
        }
    }

    private addressesAreEqual(address1: OrderAddress, address2: OrderAddress): boolean {
        return (
            address1.streetLine1 === address2.streetLine1 &&
            address1.streetLine2 === address2.streetLine2 &&
            address1.postalCode === address2.postalCode
        );
    }

    async addNoteToCustomer(ctx: RequestContext, input: AddNoteToCustomerInput): Promise<Customer> {
        const customer = await this.connection.getEntityOrThrow(ctx, Customer, input.id, {
            channelId: ctx.channelId,
        });
        await this.historyService.createHistoryEntryForCustomer(
            {
                ctx,
                customerId: customer.id,
                type: HistoryEntryType.CUSTOMER_NOTE,
                data: {
                    note: input.note,
                },
            },
            input.isPublic,
        );
        return customer;
    }

    async updateCustomerNote(ctx: RequestContext, input: UpdateCustomerNoteInput): Promise<HistoryEntry> {
        return this.historyService.updateCustomerHistoryEntry(ctx, {
            type: HistoryEntryType.CUSTOMER_NOTE,
            data: input.note ? { note: input.note } : undefined,
            ctx,
            entryId: input.noteId,
        });
    }

    async deleteCustomerNote(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        try {
            await this.historyService.deleteCustomerHistoryEntry(ctx, id);
            return {
                result: DeletionResult.DELETED,
            };
        } catch (e: any) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: e.message,
            };
        }
    }

    private async enforceSingleDefaultAddress(
        ctx: RequestContext,
        addressId: ID,
        input: CreateAddressInput | UpdateAddressInput,
    ) {
        const result = await this.connection
            .getRepository(ctx, Address)
            .findOne({ where: { id: addressId }, relations: ['customer', 'customer.addresses'] });
        if (result) {
            const customerAddressIds = result.customer.addresses
                .map(a => a.id)
                .filter(id => !idsAreEqual(id, addressId)) as string[];

            if (customerAddressIds.length) {
                if (input.defaultBillingAddress === true) {
                    await this.connection.getRepository(ctx, Address).update(customerAddressIds, {
                        defaultBillingAddress: false,
                    });
                }
                if (input.defaultShippingAddress === true) {
                    await this.connection.getRepository(ctx, Address).update(customerAddressIds, {
                        defaultShippingAddress: false,
                    });
                }
            }
        }
    }

    /**
     * If a Customer Address is to be deleted, check if it is assigned as a default for shipping or
     * billing. If so, attempt to transfer default status to one of the other addresses if there are
     * any.
     */
    private async reassignDefaultsForDeletedAddress(ctx: RequestContext, addressToDelete: Address) {
        if (!addressToDelete.defaultBillingAddress && !addressToDelete.defaultShippingAddress) {
            return;
        }
        const result = await this.connection
            .getRepository(ctx, Address)
            .findOne({ where: { id: addressToDelete.id }, relations: ['customer', 'customer.addresses'] });
        if (result) {
            const customerAddresses = result.customer.addresses;
            if (1 < customerAddresses.length) {
                const otherAddresses = customerAddresses
                    .filter(address => !idsAreEqual(address.id, addressToDelete.id))
                    .sort((a, b) => (a.id < b.id ? -1 : 1));
                if (addressToDelete.defaultShippingAddress) {
                    otherAddresses[0].defaultShippingAddress = true;
                }
                if (addressToDelete.defaultBillingAddress) {
                    otherAddresses[0].defaultBillingAddress = true;
                }
                await this.connection.getRepository(ctx, Address).save(otherAddresses[0], { reload: false });
            }
        }
    }
}
