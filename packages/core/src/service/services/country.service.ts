import { Injectable } from '@nestjs/common';
import {
    CreateCountryInput,
    DeletionResponse,
    DeletionResult,
    UpdateCountryInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound } from '../../common/utils';
import { findOptionsArrayToObject } from '../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Address } from '../../entity';
import { Channel } from '../../entity/channel/channel.entity';
import { Country } from '../../entity/region/country.entity';
import { RegionTranslation } from '../../entity/region/region-translation.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';
import { EventBus } from '../../event-bus';
import { ChannelEvent } from '../../event-bus/events/channel-event';
import { CountryEvent } from '../../event-bus/events/country-event';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

/**
 * @description
 * Contains methods relating to {@link Country} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class CountryService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private translatableSaver: TranslatableSaver,
        private eventBus: EventBus,
        private translator: TranslatorService,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Country>,
        relations: RelationPaths<Country> = [],
    ): Promise<PaginatedList<Translated<Country>>> {
        return this.listQueryBuilder
            .build(Country, options, { ctx, relations })
            .getManyAndCount()
            .then(([countries, totalItems]) => {
                const items = countries.map(country => this.translator.translate(country, ctx));
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(
        ctx: RequestContext,
        countryId: ID,
        relations: RelationPaths<Country> = [],
    ): Promise<Translated<Country> | undefined> {
        return this.connection
            .getRepository(ctx, Country)
            .findOne({
                where: { id: countryId },
                relations: findOptionsArrayToObject<Country>(relations ?? []),
            })
            .then(country => (country && this.translator.translate(country, ctx)) ?? undefined);
    }

    /**
     * @description
     * Returns an array of enabled Countries, intended for use in a public-facing (ie. Shop) API.
     */
    findAllAvailable(ctx: RequestContext): Promise<Array<Translated<Country>>> {
        return this.connection
            .getRepository(ctx, Country)
            .find({ where: { enabled: true } })
            .then(items => items.map(country => this.translator.translate(country, ctx)));
    }

    /**
     * @description
     * Returns a Country based on its ISO country code.
     */
    async findOneByCode(ctx: RequestContext, countryCode: string): Promise<Translated<Country>> {
        const country = await this.connection.getRepository(ctx, Country).findOne({
            where: {
                code: countryCode,
            },
        });
        if (!country) {
            throw new UserInputError('error.country-code-not-valid', { countryCode });
        }
        return this.translator.translate(country, ctx);
    }

    async create(ctx: RequestContext, input: CreateCountryInput): Promise<Translated<Country>> {
        const country = await this.translatableSaver.create({
            ctx,
            input,
            entityType: Country,
            translationType: RegionTranslation,
        });
        await this.eventBus.publish(new CountryEvent(ctx, country, 'created', input));
        return assertFound(this.findOne(ctx, country.id));
    }

    /**
     * @description
     * Updates a Country. When its code changes, every Channel that uses the old code as its
     * `taxCountryCode` is updated to the new one.
     */
    async update(ctx: RequestContext, input: UpdateCountryInput): Promise<Translated<Country>> {
        const previousCode = input.code
            ? (await this.connection.getEntityOrThrow(ctx, Country, input.id)).code
            : undefined;
        const country = await this.translatableSaver.update({
            ctx,
            input,
            entityType: Country,
            translationType: RegionTranslation,
        });
        if (previousCode && previousCode !== country.code) {
            await this.updateChannelTaxCountryCodes(ctx, previousCode, country.code);
        }
        await this.eventBus.publish(new CountryEvent(ctx, country, 'updated', input));
        return assertFound(this.findOne(ctx, country.id));
    }

    /**
     * The Channel's `taxCountryCode` has no foreign key, so it follows a code change here. Each
     * Channel gets a ChannelEvent, which clears the cached Channels.
     */
    private async updateChannelTaxCountryCodes(ctx: RequestContext, previousCode: string, code: string) {
        const repository = this.connection.getRepository(ctx, Channel);
        const channels = await repository.find({ where: { taxCountryCode: previousCode } });
        for (const channel of channels) {
            channel.taxCountryCode = code;
            await repository.update(channel.id, { taxCountryCode: code });
            await this.eventBus.publish(
                new ChannelEvent(ctx, channel, 'updated', { id: channel.id, taxCountryCode: code }),
            );
        }
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const country = await this.connection.getEntityOrThrow(ctx, Country, id);
        const addressesUsingCountry = await this.connection
            .getRepository(ctx, Address)
            .createQueryBuilder('address')
            .where('address.country = :id', { id })
            .getCount();

        if (0 < addressesUsingCountry) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.country-used-in-addresses', { count: addressesUsingCountry }),
            };
        }
        const taxRatesUsingCountry = await this.connection
            .getRepository(ctx, TaxRate)
            .createQueryBuilder('taxRate')
            .where('taxRate.region = :id', { id })
            .orderBy('taxRate.id')
            .getMany();
        if (0 < taxRatesUsingCountry.length) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.country-used-in-tax-rates', {
                    taxRateNames: taxRatesUsingCountry.map(t => t.name).join(', '),
                }),
            };
        }
        const channelsUsingCountry = await this.connection
            .getRepository(ctx, Channel)
            .find({ where: { taxCountryCode: country.code }, order: { id: 'ASC' } });
        if (0 < channelsUsingCountry.length) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.country-used-as-channel-tax-country', {
                    channelCodes: channelsUsingCountry.map(c => c.code).join(', '),
                }),
            };
        } else {
            const deletedCountry = new Country(country);
            await this.connection.getRepository(ctx, Country).remove(country);
            await this.eventBus.publish(new CountryEvent(ctx, deletedCountry, 'deleted', id));
            return {
                result: DeletionResult.DELETED,
                message: '',
            };
        }
    }
}
