import { Injectable } from '@nestjs/common';
import { ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { RequestContext } from '../../../api/common/request-context';
import {
    ConfigService,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    Logger,
} from '../../../config';
import { manualFulfillmentHandler } from '../../../config/fulfillment/manual-fulfillment-handler';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel, Collection, FacetValue, TaxCategory, User } from '../../../entity';
import {
    CollectionService,
    FacetValueService,
    PaymentMethodService,
    RequestContextService,
    RoleService,
    ShippingMethodService,
} from '../../../service';
import { ChannelService } from '../../../service/services/channel.service';
import { CountryService } from '../../../service/services/country.service';
import { SearchService } from '../../../service/services/search.service';
import { TaxCategoryService } from '../../../service/services/tax-category.service';
import { TaxRateService } from '../../../service/services/tax-rate.service';
import { ZoneService } from '../../../service/services/zone.service';
import {
    CollectionFilterDefinition,
    CountryDefinition,
    InitialData,
    RoleDefinition,
    ZoneMap,
} from '../../types';
import { AssetImporter } from '../asset-importer/asset-importer';

/**
 * @description
 * Responsible for populating the database with {@link InitialData}, i.e. non-product data such as countries, tax rates,
 * shipping methods, payment methods & roles.
 *
 * @docsCategory import-export
 */
@Injectable()
export class Populator {
    /** @internal */
    constructor(
        private countryService: CountryService,
        private zoneService: ZoneService,
        private channelService: ChannelService,
        private taxRateService: TaxRateService,
        private taxCategoryService: TaxCategoryService,
        private shippingMethodService: ShippingMethodService,
        private paymentMethodService: PaymentMethodService,
        private collectionService: CollectionService,
        private facetValueService: FacetValueService,
        private searchService: SearchService,
        private assetImporter: AssetImporter,
        private roleService: RoleService,
        private configService: ConfigService,
        private connection: TransactionalConnection,
        private requestContextService: RequestContextService,
    ) {}

    /**
     * @description
     * Should be run *before* populating the products, so that there are TaxRates by which
     * product prices can be set. If the `channel` argument is set, then any {@link ChannelAware}
     * entities will be assigned to that Channel.
     */
    async populateInitialData(data: InitialData, channel?: Channel) {
        const ctx = await this.createRequestContext(data, channel);
        let zoneMap: ZoneMap;
        try {
            zoneMap = await this.populateCountries(ctx, data.countries);
        } catch (e: any) {
            Logger.error('Could not populate countries');
            Logger.error(e, 'populator', e.stack);
            throw e;
        }
        try {
            await this.populateTaxRates(ctx, data.taxRates, zoneMap);
        } catch (e: any) {
            Logger.error('Could not populate tax rates');
            Logger.error(e, 'populator', e.stack);
        }
        try {
            await this.populateShippingMethods(ctx, data.shippingMethods);
        } catch (e: any) {
            Logger.error('Could not populate shipping methods');
            Logger.error(e, 'populator', e.stack);
        }
        try {
            await this.populatePaymentMethods(ctx, data.paymentMethods);
        } catch (e: any) {
            Logger.error('Could not populate payment methods');
            Logger.error(e, 'populator', e.stack);
        }
        try {
            await this.setChannelDefaults(zoneMap, data, ctx.channel);
        } catch (e: any) {
            Logger.error('Could not set channel defaults');
            Logger.error(e, 'populator', e.stack);
        }
        try {
            await this.populateRoles(ctx, data.roles);
        } catch (e: any) {
            Logger.error('Could not populate roles');
            Logger.error(e, 'populator', e.stack);
        }
    }

    /**
     * @description
     * Should be run *after* the products have been populated, otherwise the expected FacetValues will not
     * yet exist.
     */
    async populateCollections(data: InitialData, channel?: Channel) {
        const ctx = await this.createRequestContext(data, channel);

        const allFacetValues = await this.facetValueService.findAll(ctx, ctx.languageCode);
        const collectionMap = new Map<string, Collection>();
        for (const collectionDef of data.collections) {
            const parent = collectionDef.parentName && collectionMap.get(collectionDef.parentName);
            const parentId = parent ? parent.id.toString() : undefined;
            const { assets } = await this.assetImporter.getAssets(collectionDef.assetPaths || [], ctx);
            let filters: ConfigurableOperationInput[] = [];
            try {
                filters = (collectionDef.filters || []).map(filter =>
                    this.processFilterDefinition(filter, allFacetValues),
                );
            } catch (e: any) {
                Logger.error(e.message);
            }
            const collection = await this.collectionService.create(ctx, {
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name: collectionDef.name,
                        description: collectionDef.description || '',
                        slug: collectionDef.slug ?? collectionDef.name,
                    },
                ],
                isPrivate: collectionDef.private || false,
                parentId,
                assetIds: assets.map(a => a.id.toString()),
                featuredAssetId: assets.length ? assets[0].id.toString() : undefined,
                filters,
                inheritFilters: collectionDef.inheritFilters ?? true,
            });
            collectionMap.set(collectionDef.name, collection);
        }
        // Wait for the created collection operations to complete before running
        // the reindex of the search index.
        await new Promise(resolve => setTimeout(resolve, 50));
        await this.searchService.reindex(ctx);
    }

    private processFilterDefinition(
        filter: CollectionFilterDefinition,
        allFacetValues: FacetValue[],
    ): ConfigurableOperationInput {
        switch (filter.code) {
            case 'facet-value-filter':
                const facetValueIds = filter.args.facetValueNames
                    .map(name =>
                        allFacetValues.find(fv => {
                            let facetName;
                            let valueName = name;
                            if (name.includes(':')) {
                                [facetName, valueName] = name.split(':');
                                return (
                                    (fv.name === valueName || fv.code === valueName) &&
                                    (fv.facet.name === facetName || fv.facet.code === facetName)
                                );
                            } else {
                                return fv.name === valueName || fv.code === valueName;
                            }
                        }),
                    )
                    .filter(notNullOrUndefined)
                    .map(fv => fv.id);
                return {
                    code: filter.code,
                    arguments: [
                        {
                            name: 'facetValueIds',
                            value: JSON.stringify(facetValueIds),
                        },
                        {
                            name: 'containsAny',
                            value: filter.args.containsAny.toString(),
                        },
                    ],
                };
            default:
                throw new Error(`Filter with code "${filter.code as string}" is not recognized.`);
        }
    }

    private async createRequestContext(data: InitialData, channel?: Channel) {
        const { superadminCredentials } = this.configService.authOptions;
        const superAdminUser = await this.connection.rawConnection.getRepository(User).findOne({
            where: {
                identifier: superadminCredentials.identifier,
            },
        });
        const ctx = await this.requestContextService.create({
            user: superAdminUser ?? undefined,
            apiType: 'admin',
            languageCode: data.defaultLanguage,
            channelOrToken: channel ?? (await this.channelService.getDefaultChannel()),
        });
        return ctx;
    }

    private async setChannelDefaults(zoneMap: ZoneMap, data: InitialData, channel: Channel) {
        const defaultZone = zoneMap.get(data.defaultZone);
        if (!defaultZone) {
            throw new Error(
                `The defaultZone (${data.defaultZone}) did not match any existing or created zone names`,
            );
        }
        const defaultZoneId = defaultZone.entity.id;
        await this.channelService.update(RequestContext.empty(), {
            id: channel.id,
            defaultTaxZoneId: defaultZoneId,
            defaultShippingZoneId: defaultZoneId,
        });
    }

    private async populateCountries(ctx: RequestContext, countries: CountryDefinition[]): Promise<ZoneMap> {
        const zoneMap: ZoneMap = new Map();
        const existingZones = await this.zoneService.getAllWithMembers(ctx);
        for (const zone of existingZones) {
            zoneMap.set(zone.name, { entity: zone, members: zone.members.map(m => m.id) });
        }
        for (const { name, code, zone } of countries) {
            const countryEntity = await this.countryService.create(ctx, {
                code,
                enabled: true,
                translations: [{ languageCode: ctx.languageCode, name }],
            });

            let zoneItem = zoneMap.get(zone);
            if (!zoneItem) {
                const zoneEntity = await this.zoneService.create(ctx, { name: zone });
                zoneItem = { entity: zoneEntity, members: [] };
                zoneMap.set(zone, zoneItem);
            }
            if (!zoneItem.members.includes(countryEntity.id)) {
                zoneItem.members.push(countryEntity.id);
            }
        }

        // add the countries to the respective zones
        for (const zoneItem of zoneMap.values()) {
            await this.zoneService.addMembersToZone(ctx, {
                zoneId: zoneItem.entity.id,
                memberIds: zoneItem.members,
            });
        }

        return zoneMap;
    }

    private async populateTaxRates(
        ctx: RequestContext,
        taxRates: Array<{ name: string; percentage: number }>,
        zoneMap: ZoneMap,
    ) {
        for (const taxRate of taxRates) {
            const category = await this.taxCategoryService.create(ctx, { name: taxRate.name });

            for (const { entity } of zoneMap.values()) {
                await this.taxRateService.create(ctx, {
                    zoneId: entity.id,
                    value: taxRate.percentage,
                    categoryId: category.id,
                    name: `${taxRate.name} ${entity.name}`,
                    enabled: true,
                });
            }
        }
    }

    private async populateShippingMethods(
        ctx: RequestContext,
        shippingMethods: Array<{ name: string; price: number; taxRate?: number }>,
    ) {
        for (const method of shippingMethods) {
            await this.shippingMethodService.create(ctx, {
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: method.price.toString() },
                        { name: 'taxRate', value: method.taxRate ? method.taxRate.toString() : '0' },
                        { name: 'includesTax', value: 'auto' },
                    ],
                },
                code: normalizeString(method.name, '-'),
                translations: [{ languageCode: ctx.languageCode, name: method.name, description: '' }],
            });
        }
    }

    private async populatePaymentMethods(ctx: RequestContext, paymentMethods: InitialData['paymentMethods']) {
        for (const method of paymentMethods) {
            await this.paymentMethodService.create(ctx, {
                code: normalizeString(method.name, '-'),
                enabled: true,
                handler: method.handler,
                translations: [{ languageCode: ctx.languageCode, name: method.name, description: '' }],
            });
        }
    }

    private async populateRoles(ctx: RequestContext, roles?: RoleDefinition[]) {
        if (!roles) {
            return;
        }
        for (const roleDef of roles) {
            await this.roleService.create(ctx, roleDef);
        }
    }
}
