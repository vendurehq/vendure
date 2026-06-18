import { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { Request, Response } from 'express';
import { GraphQLResolveInfo } from 'graphql';

import { InternalServerError } from '../../common/error/errors';

export type RestContext = { req: Request; res: Response; isGraphQL: false; info: undefined };
export type GraphQLContext = {
    req: Request;
    res: Response;
    isGraphQL: true;
    info: GraphQLResolveInfo;
};

/**
 * Parses in the Nest ExecutionContext of the incoming request, accounting for both
 * GraphQL & REST requests.
 */
export function parseContext(context: ExecutionContext | ArgumentsHost): RestContext | GraphQLContext {
    // TODO: Remove this check once this issue is resolved: https://github.com/nestjs/graphql/pull/1469
    if ((context as ExecutionContext).getHandler?.()?.name === '__resolveType') {
        return {
            req: context.getArgs()[1].req,
            res: context.getArgs()[1].res,
            isGraphQL: false,
            info: undefined,
        };
    }

    if (context.getType() === 'http') {
        const httpContext = context.switchToHttp();
        return {
            isGraphQL: false,
            req: httpContext.getRequest(),
            res: httpContext.getResponse(),
            info: undefined,
        };
    } else if (context.getType<GqlContextType>() === 'graphql') {
        const gqlContext = GqlExecutionContext.create(context as ExecutionContext);
        return {
            isGraphQL: true,
            req: gqlContext.getContext().req,
            res: gqlContext.getContext().res,
            info: gqlContext.getInfo(),
        };
    } else {
        throw new InternalServerError(`Context "${context.getType()}" is not supported.`);
    }
}
