import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { IdOperators } from '@vendure/common/lib/generated-types';
import { GraphQLField, GraphQLSchema } from 'graphql';
import { Observable } from 'rxjs';

import { GraphqlValueTransformer } from '../common/graphql-value-transformer';
import { IdCodecService } from '../common/id-codec.service';
import { parseContext } from '../common/parse-context';

export const ID_CODEC_TRANSFORM_KEYS = 'idCodecTransformKeys';

/**
 * This interceptor automatically decodes incoming requests so that any
 * ID values are transformed correctly as per the configured EntityIdStrategy.
 *
 * ID values are defined as properties with the name "id", or properties with names matching any
 * arguments passed to the {@link Decode} decorator.
 */
@Injectable()
export class IdInterceptor implements NestInterceptor {
    private graphQlValueTransformers = new WeakMap<GraphQLSchema, GraphqlValueTransformer>();
    constructor(private idCodecService: IdCodecService) {}

    intercept(context: ExecutionContext, next: CallHandler<any>): Observable<any> {
        const { isGraphQL, info } = parseContext(context);
        if (isGraphQL && info) {
            const args = GqlExecutionContext.create(context).getArgs();
            // Read the argument types from the definition of the field being resolved. `info.operation`
            // does not include named fragment definitions, and two fields in one operation can each have
            // an argument of the same name with a different input type.
            const field = info.parentType.getFields()[info.fieldName];
            const transformer = this.getTransformerForSchema(info.schema);
            this.decodeIdArguments(transformer, field, args);
        }
        return next.handle();
    }

    private getTransformerForSchema(schema: GraphQLSchema): GraphqlValueTransformer {
        const existing = this.graphQlValueTransformers.get(schema);
        if (existing) {
            return existing;
        }
        const transformer = new GraphqlValueTransformer(schema);
        this.graphQlValueTransformers.set(schema, transformer);
        return transformer;
    }

    private decodeIdArguments(
        graphqlValueTransformer: GraphqlValueTransformer,
        field: GraphQLField<unknown, unknown>,
        variables: Record<string, any> = {},
    ) {
        const typeTree = graphqlValueTransformer.getArgumentTypeTree(field);
        graphqlValueTransformer.transformValues(typeTree, variables, (value, type) => {
            if (type?.name === 'ID') {
                return this.idCodecService.decode(value);
            }
            if (type?.name === 'IDOperators') {
                const keys: Array<keyof IdOperators> = ['eq', 'notEq', 'in', 'notIn'];
                return this.idCodecService.decode(value, keys);
            }
            return value;
        });
        return variables;
    }
}
