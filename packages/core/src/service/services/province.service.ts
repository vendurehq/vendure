import { Injectable } from '@nestjs/common';
import {
    CreateProvinceInput,
    DeletionResponse,
    DeletionResult,
    UpdateProvinceInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList, Type } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Province } from '../../entity/region/province.entity';
import { RegionTranslation } from '../../entity/region/region-translation.entity';
import { Region } from '../../entity/region/region.entity';
import { EventBus } from '../../event-bus';
import { ProvinceEvent } from '../../event-bus/events/province-event';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

/**
 * @description
 * Contains methods relating to {@link Province} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class ProvinceService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private translatableSaver: TranslatableSaver,
        private eventBus: EventBus,
        private translator: TranslatorService,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Province>,
        relations: RelationPaths<Province> = [],
    ): Promise<PaginatedList<Translated<Province>>> {
        return this.listQueryBuilder
            .build(Province as Type<Province>, options, { ctx, relations })
            .getManyAndCount()
            .then(([provinces, totalItems]) => {
                const items = provinces.map(province => this.translator.translate(province, ctx));
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(
        ctx: RequestContext,
        provinceId: ID,
        relations: RelationPaths<Province> = [],
    ): Promise<Translated<Province> | undefined> {
        return this.connection
            .getRepository(ctx, Province)
            .findOne({ where: { id: provinceId }, relations })
            .then(province => (province && this.translator.translate(province, ctx)) ?? undefined);
    }

    async create(ctx: RequestContext, input: CreateProvinceInput): Promise<Translated<Province>> {
        const province = await this.translatableSaver.create({
            ctx,
            input,
            entityType: Province as Type<Region>,
            translationType: RegionTranslation,
        });
        await this.eventBus.publish(new ProvinceEvent(ctx, province, 'created', input));
        return assertFound(this.findOne(ctx, province.id));
    }

    async update(ctx: RequestContext, input: UpdateProvinceInput): Promise<Translated<Province>> {
        const province = await this.translatableSaver.update({
            ctx,
            input,
            entityType: Province as Type<Region>,
            translationType: RegionTranslation,
        });
        await this.eventBus.publish(new ProvinceEvent(ctx, province, 'updated', input));
        return assertFound(this.findOne(ctx, province.id));
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const region = await this.connection.getEntityOrThrow(ctx, Province as Type<Province>, id);

        const deletedProvince = new Province(region);
        await this.connection.getRepository(ctx, Province).remove(region);
        await this.eventBus.publish(new ProvinceEvent(ctx, deletedProvince, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
            message: '',
        };
    }
}
