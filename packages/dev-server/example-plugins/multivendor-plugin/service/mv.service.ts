import { Injectable } from '@nestjs/common';
import { CreateAdministratorInput, Permission } from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {
    AdministratorService,
    Channel,
    ChannelService,
    ConfigService,
    defaultShippingCalculator,
    InternalServerError,
    isGraphQlErrorResult,
    manualFulfillmentHandler,
    RequestContext,
    RequestContextService,
    RoleService,
    SellerService,
    ShippingMethod,
    ShippingMethodService,
    StockLocation,
    StockLocationService,
    TaxSetting,
    TransactionalConnection,
    User,
} from '@vendure/core';

import { multivendorShippingEligibilityChecker } from '../config/mv-shipping-eligibility-checker';
import { CreateSellerInput } from '../types';

@Injectable()
export class MultivendorService {
    constructor(
        private administratorService: AdministratorService,
        private sellerService: SellerService,
        private roleService: RoleService,
        private channelService: ChannelService,
        private shippingMethodService: ShippingMethodService,
        private configService: ConfigService,
        private stockLocationService: StockLocationService,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
    ) {}

    async registerNewSeller(ctx: RequestContext, input: { shopName: string; seller: CreateSellerInput }) {
        const superAdminCtx = await this.getSuperAdminContext(ctx);
        const channel = await this.createSellerChannelRoleAdmin(superAdminCtx, input);
        await this.createSellerShippingMethod(superAdminCtx, input.shopName, channel);
        await this.createSellerStockLocation(superAdminCtx, input.shopName, channel);
        return channel;
    }

    private async createSellerShippingMethod(ctx: RequestContext, shopName: string, sellerChannel: Channel) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const { shippingEligibilityCheckers, shippingCalculators, fulfillmentHandlers } =
            this.configService.shippingOptions;
        const shopCode = normalizeString(shopName, '-');
        const checker = shippingEligibilityCheckers.find(
            c => c.code === multivendorShippingEligibilityChecker.code,
        );
        const calculator = shippingCalculators.find(c => c.code === defaultShippingCalculator.code);
        const fulfillmentHandler = fulfillmentHandlers.find(h => h.code === manualFulfillmentHandler.code);
        if (!checker) {
            throw new InternalServerError(
                'Could not find a suitable ShippingEligibilityChecker for the seller',
            );
        }
        if (!calculator) {
            throw new InternalServerError('Could not find a suitable ShippingCalculator for the seller');
        }
        if (!fulfillmentHandler) {
            throw new InternalServerError('Could not find a suitable FulfillmentHandler for the seller');
        }
        const shippingMethod = await this.shippingMethodService.create(ctx, {
            code: `${shopCode}-shipping`,
            checker: {
                code: checker.code,
                arguments: [],
            },
            calculator: {
                code: calculator.code,
                arguments: [
                    { name: 'rate', value: '500' },
                    { name: 'includesTax', value: TaxSetting.auto },
                    { name: 'taxRate', value: '20' },
                ],
            },
            fulfillmentHandler: fulfillmentHandler.code,
            translations: [
                {
                    languageCode: defaultChannel.defaultLanguageCode,
                    name: `Standard Shipping for ${shopName}`,
                },
            ],
        });

        await this.channelService.assignToChannels(ctx, ShippingMethod, shippingMethod.id, [
            sellerChannel.id,
        ]);
    }

    private async createSellerStockLocation(ctx: RequestContext, shopName: string, sellerChannel: Channel) {
        const stockLocation = await this.stockLocationService.create(ctx, {
            name: `${shopName} Warehouse`,
        });
        await this.channelService.assignToChannels(ctx, StockLocation, stockLocation.id, [sellerChannel.id]);
    }

    private async createSellerChannelRoleAdmin(
        ctx: RequestContext,
        input: { shopName: string; seller: CreateSellerInput },
    ) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const shopCode = normalizeString(input.shopName, '-');
        const seller = await this.sellerService.create(ctx, {
            name: input.shopName,
            customFields: {
                // This simulates a connection to a payment provider,
                // which would supply the connected account ID.
                // In this case we just use a pseudo-random string
                connectedAccountId: Math.random().toString(30).substring(3),
            },
        });
        const channel = await this.channelService.create(ctx, {
            code: shopCode,
            sellerId: seller.id,
            token: `${shopCode}-token`,
            currencyCode: defaultChannel.defaultCurrencyCode,
            defaultLanguageCode: defaultChannel.defaultLanguageCode,
            pricesIncludeTax: defaultChannel.pricesIncludeTax,
            defaultShippingZoneId: defaultChannel.defaultShippingZone.id,
            defaultTaxZoneId: defaultChannel.defaultTaxZone.id,
        });
        if (isGraphQlErrorResult(channel)) {
            throw new InternalServerError(channel.message);
        }
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const customerRole = await this.roleService.getCustomerRole(ctx);
        await this.roleService.assignRoleToChannel(ctx, superAdminRole.id, channel.id);
        const role = await this.roleService.create(ctx, {
            code: `${shopCode}-admin`,
            channelIds: [channel.id],
            description: `Administrator of ${input.shopName}`,
            permissions: [
                Permission.CreateCatalog,
                Permission.UpdateCatalog,
                Permission.ReadCatalog,
                Permission.DeleteCatalog,
                Permission.CreateOrder,
                Permission.ReadOrder,
                Permission.UpdateOrder,
                Permission.DeleteOrder,
                Permission.ReadCustomer,
                Permission.ReadPaymentMethod,
                Permission.ReadShippingMethod,
                Permission.ReadPromotion,
                Permission.ReadCountry,
                Permission.ReadZone,
                Permission.CreateCustomer,
                Permission.UpdateCustomer,
                Permission.DeleteCustomer,
                Permission.CreateTag,
                Permission.ReadTag,
                Permission.UpdateTag,
                Permission.DeleteTag,
            ],
        });
        const administrator = await this.administratorService.create(ctx, {
            firstName: input.seller.firstName,
            lastName: input.seller.lastName,
            emailAddress: input.seller.emailAddress,
            password: input.seller.password,
            roleIds: [role.id],
        });
        return channel;
    }

    private async getSuperAdminContext(ctx: RequestContext): Promise<RequestContext> {
        const { superadminCredentials } = this.configService.authOptions;
        const superAdminUser = await this.connection.getRepository(ctx, User).findOne({
            where: {
                identifier: superadminCredentials.identifier,
            },
        });
        return this.requestContextService.create({
            apiType: 'shop',
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            user: superAdminUser!,
        });
    }
}
