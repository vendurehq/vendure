import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { isFieldResolver } from '../common/is-field-resolver';
import { parseContext } from '../common/parse-context';
import { internal_getRequestContext } from '../common/request-context';

/**
 * @description
 * Resolver param decorator which extracts the {@link RequestContext} from the incoming
 * request object.
 *
 * @example
 * ```ts
 *  \@Query()
 *  getAdministrators(\@Ctx() ctx: RequestContext) {
 *      // ...
 *  }
 * ```
 *
 * @docsCategory request
 * @docsPage Ctx Decorator
 */
export const Ctx = createParamDecorator((data, executionContext: ExecutionContext) => {
    const context = parseContext(executionContext);
    const handlerIsFieldResolver = context.isGraphQL && isFieldResolver(context.info);
    return internal_getRequestContext(context.req, handlerIsFieldResolver ? undefined : executionContext);
});
