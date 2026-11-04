import { DeletionResponse, MutationCreateProvinceArgs, MutationDeleteProvinceArgs, MutationUpdateProvinceArgs, QueryProvinceArgs, QueryProvincesArgs } from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';
import { Translated } from '../../../common/types/locale-types';
import { Province } from '../../../entity/region/province.entity';
import { ProvinceService } from '../../../service/services/province.service';
import { RequestContext } from '../../common/request-context';
import { RelationPaths } from '../../decorators/relations.decorator';
export declare class ProvinceResolver {
    private provinceService;
    constructor(provinceService: ProvinceService);
    provinces(ctx: RequestContext, args: QueryProvincesArgs, relations: RelationPaths<Province>): Promise<PaginatedList<Translated<Province>>>;
    province(ctx: RequestContext, args: QueryProvinceArgs, relations: RelationPaths<Province>): Promise<Translated<Province> | undefined>;
    createProvince(ctx: RequestContext, args: MutationCreateProvinceArgs): Promise<Translated<Province>>;
    updateProvince(ctx: RequestContext, args: MutationUpdateProvinceArgs): Promise<Translated<Province>>;
    deleteProvince(ctx: RequestContext, args: MutationDeleteProvinceArgs): Promise<DeletionResponse>;
}
