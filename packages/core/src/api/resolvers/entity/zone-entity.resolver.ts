import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { Country } from '../../../entity/region/country.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { ZoneService } from '../../../service/services/zone.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Zone')
export class ZoneEntityResolver {
    constructor(private zoneService: ZoneService) {}

    @ResolveField()
    async members(@Ctx() ctx: RequestContext, @Parent() zone: Zone): Promise<Country[]> {
        if (Array.isArray(zone.members)) {
            return zone.members;
        }
        const zoneWithMembers = await this.zoneService.findOne(ctx, zone.id);
        return zoneWithMembers?.members ?? [];
    }
}
