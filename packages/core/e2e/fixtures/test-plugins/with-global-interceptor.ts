import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { VendurePlugin } from '@vendure/core';
import { GraphQLResolveInfo } from 'graphql';
import gql from 'graphql-tag';
import { Observable } from 'rxjs';

/**
 * Records the `Type.field` of every GraphQL resolver which the interceptor below was
 * invoked for, so that a test can assert whether or not field resolvers were included.
 */
@Injectable()
export class InterceptedFieldLog {
    readonly intercepted: string[] = [];
}

@Injectable()
export class RecordingInterceptor implements NestInterceptor {
    constructor(private log: InterceptedFieldLog) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        if (context.getType<GqlContextType>() === 'graphql') {
            const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();
            this.log.intercepted.push(`${info.parentType.name}.${info.fieldName}`);
        }
        return next.handle();
    }
}

@Resolver()
export class InterceptedFieldsQueryResolver {
    constructor(private log: InterceptedFieldLog) {}

    @Query()
    interceptedFields() {
        return this.log.intercepted;
    }
}

@Resolver('Product')
export class ProductProbeFieldResolver {
    @ResolveField()
    interceptorProbe() {
        return 'probed';
    }
}

@VendurePlugin({
    adminApiExtensions: {
        resolvers: [InterceptedFieldsQueryResolver, ProductProbeFieldResolver],
        schema: gql`
            extend type Query {
                interceptedFields: [String!]!
            }

            extend type Product {
                interceptorProbe: String!
            }
        `,
    },
    providers: [
        InterceptedFieldLog,
        {
            provide: APP_INTERCEPTOR,
            useClass: RecordingInterceptor,
        },
    ],
})
export class GlobalInterceptorPlugin {}
