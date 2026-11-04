import { CreateProvinceInput, DeletionResponse, UpdateProvinceInput } from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Province } from '../../entity/region/province.entity';
import { EventBus } from '../../event-bus';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
/**
 * @description
 * Contains methods relating to {@link Province} entities.
 *
 * @docsCategory services
 */
export declare class ProvinceService {
    private connection;
    private listQueryBuilder;
    private translatableSaver;
    private eventBus;
    private translator;
    constructor(connection: TransactionalConnection, listQueryBuilder: ListQueryBuilder, translatableSaver: TranslatableSaver, eventBus: EventBus, translator: TranslatorService);
    findAll(ctx: RequestContext, options?: ListQueryOptions<Province>, relations?: RelationPaths<Province>): Promise<PaginatedList<Translated<Province>>>;
    findOne(ctx: RequestContext, provinceId: ID, relations?: RelationPaths<Province>): Promise<Translated<Province> | undefined>;
    create(ctx: RequestContext, input: CreateProvinceInput): Promise<Translated<Province>>;
    update(ctx: RequestContext, input: UpdateProvinceInput): Promise<Translated<Province>>;
    delete(ctx: RequestContext, id: ID): Promise<DeletionResponse>;
}
