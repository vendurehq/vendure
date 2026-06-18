import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GraphQLResolveInfo } from 'graphql';

import { getApiType } from '../common/get-api-type';

/**
 * @description
 * Resolver param decorator which returns which Api the request came though.
 * This is useful because sometimes the same resolver will have different behaviour
 * depending whether it is being called from the shop API or the admin API.
 *
 * Returns a string of type {@link ApiType}.
 *
 * @example
 * ```ts
 *  \@Query()
 *  getAdministrators(\@Api() apiType: ApiType) {
 *    if (apiType === 'admin') {
 *      // ...
 *    }
 *  }
 * ```
 * @docsCategory request
 * @docsPage Api Decorator
 */
export const Api = createParamDecorator((data, ctx: ExecutionContext) => {
    const info = ctx.getArgByIndex(3);
    return getApiType(info);
});
