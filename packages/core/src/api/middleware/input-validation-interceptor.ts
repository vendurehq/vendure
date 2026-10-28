import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GraphQLInputType, isInputObjectType, isListType, isNonNullType } from 'graphql';
import { Observable } from 'rxjs';

import { UserInputError } from '../../common/error/errors';
import { parseContext } from '../common/parse-context';

/**
 * @description
 * Rejects a mutation when an input field marked with the `@nonBlank` directive is given an
 * empty or whitespace-only string. Nested input objects and lists are checked too. A field
 * which is omitted or `null` is not checked, so `@nonBlank` works on partial update inputs.
 *
 * @since 3.9.0
 */
@Injectable()
export class InputValidationInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler<any>): Observable<any> {
        const parsedContext = parseContext(context);
        if (!parsedContext.isGraphQL) {
            return next.handle();
        }
        const { info } = parsedContext;
        if (info.parentType !== info.schema.getMutationType()) {
            return next.handle();
        }
        const args = GqlExecutionContext.create(context).getArgs();
        for (const argDef of info.parentType.getFields()[info.fieldName].args) {
            assertNonBlank(args[argDef.name], argDef.type);
        }
        return next.handle();
    }
}

function assertNonBlank(value: unknown, type: GraphQLInputType): void {
    if (value == null) {
        return;
    }
    if (isNonNullType(type)) {
        return assertNonBlank(value, type.ofType);
    }
    if (isListType(type)) {
        if (Array.isArray(value)) {
            value.forEach(item => assertNonBlank(item, type.ofType));
        }
        return;
    }
    if (!isInputObjectType(type) || typeof value !== 'object') {
        return;
    }
    for (const field of Object.values(type.getFields())) {
        const fieldValue = (value as Record<string, unknown>)[field.name];
        const isNonBlank = field.astNode?.directives?.some(d => d.name.value === 'nonBlank');
        if (isNonBlank && typeof fieldValue === 'string' && fieldValue.trim() === '') {
            throw new UserInputError('error.field-cannot-be-blank', { fieldName: field.name });
        }
        assertNonBlank(fieldValue, field.type);
    }
}
