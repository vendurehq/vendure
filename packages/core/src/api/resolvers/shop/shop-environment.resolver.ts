import { Query, Resolver } from '@nestjs/graphql';

import { Channel } from '../../../entity';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver()
export class ShopEnvironmentResolver {
    @Query()
    async activeChannel(@Ctx() ctx: RequestContext): Promise<Channel> {
        return ctx.channel;
    }
}
