import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { getNamedType } from 'graphql';
import { Observable } from 'rxjs';

import { UserInputError } from '../../common/error/errors';
import { ConfigService } from '../../config/config.service';
import { parseContext } from '../common/parse-context';
import { requiredInputFields } from '../common/required-input-fields';

/**
 * @description
 * Interceptor that validates string fields on GraphQL mutation inputs are not blank
 * (empty or whitespace-only). Uses a hand-curated registry of fields that are
 * business-required — description fields and system-populated defaults are excluded.
 *
 * Only validates top-level mutation arguments. Nested input types (e.g. within arrays
 * passed as non-argument fields) are not covered and should be validated in the
 * service layer if needed.
 *
 * Can be disabled via `apiOptions.inputValidation.requiredFieldValidation: false`.
 *
 * @since 3.8.0
 */
@Injectable()
export class InputValidationInterceptor implements NestInterceptor {
    constructor(private readonly configService: ConfigService) {}

    intercept(context: ExecutionContext, next: CallHandler<any>): Observable<any> {
        const parsedContext = parseContext(context);

        if (!parsedContext.isGraphQL) {
            return next.handle();
        }

        const { operation, schema, fieldName } = parsedContext.info;
        if (operation.operation !== 'mutation') {
            return next.handle();
        }

        if (this.configService.apiOptions.inputValidation?.requiredFieldValidation === false) {
            return next.handle();
        }

        const gqlExecutionContext = GqlExecutionContext.create(context);
        const variables = gqlExecutionContext.getArgs();

        const mutationType = schema.getMutationType();
        const fieldDef = mutationType?.getFields()[fieldName];
        if (!fieldDef) {
            return next.handle();
        }

        for (const arg of fieldDef.args) {
            const typeName = getNamedType(arg.type).name;
            const spec = requiredInputFields[typeName];
            if (spec && variables[arg.name]) {
                const inputValues = Array.isArray(variables[arg.name])
                    ? variables[arg.name]
                    : [variables[arg.name]];
                for (const inputValue of inputValues) {
                    this.validateInput(spec, inputValue);
                }
            }
        }

        return next.handle();
    }

    private validateInput(
        spec: { fields?: string[]; translations?: string[] },
        inputValue: Record<string, any>,
    ) {
        if (spec.fields) {
            this.checkBlank(inputValue, spec.fields);
        }
        if (spec.translations && Array.isArray(inputValue.translations)) {
            for (const translation of inputValue.translations) {
                if (translation && typeof translation === 'object') {
                    this.checkBlank(translation, spec.translations);
                }
            }
        }
    }

    private checkBlank(obj: Record<string, any>, fieldNames: string[]) {
        for (const fieldName of fieldNames) {
            const value = obj[fieldName];
            if (typeof value === 'string' && value.trim() === '') {
                throw new UserInputError('error.field-cannot-be-blank', { fieldName });
            }
        }
    }
}
