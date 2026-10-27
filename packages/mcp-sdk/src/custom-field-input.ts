import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import type { CustomFieldConfig, CustomFields, Injector, RequestContext } from '@vendure/core';
import {
    ConfigService,
    isLocalizedCustomFieldType,
    UserInputError,
    validateCustomFieldValue,
} from '@vendure/core';

/**
 * @description
 * Checks the custom fields a tool received before the tool saves them. Tool calls skip the
 * checks Vendure's GraphQL API does on custom fields, so call this in any tool that accepts them.
 *
 * It refuses a key that is not a custom field of `entityName`, an `internal` field, and a
 * non-`public` field sent by a Shop API caller. It then runs Vendure's normal custom field
 * validation on the rest. Any refusal throws a `UserInputError`. A relation field uses its
 * input name, so a field named `image` arrives as `imageId`.
 *
 * A localized custom field (`localeString` or `localeText`) is stored on the translation of the
 * entity, so, as in the GraphQL API, it is only accepted in the custom fields of a translation. Pass
 * `{ translation: true }` to check those: they take only the localized custom fields.
 *
 * @example
 * ```ts
 * import { Injectable } from '\@nestjs/common';
 * import { ModuleRef } from '\@nestjs/core';
 * import { Injector, RequestContext } from '\@vendure/core';
 * import { assertCustomFieldsWritable, McpToolHandler } from '\@vendure/mcp-sdk';
 *
 * type UpdateCustomerInput = { id: string; customFields?: Record<string, unknown> };
 *
 * \@Injectable()
 * export class UpdateCustomerTool implements McpToolHandler<UpdateCustomerInput> {
 *     constructor(private readonly moduleRef: ModuleRef) {}
 *
 *     async execute(ctx: RequestContext, input: UpdateCustomerInput) {
 *         await assertCustomFieldsWritable(
 *             ctx,
 *             new Injector(this.moduleRef),
 *             'Customer',
 *             input.customFields,
 *         );
 *         // ...write the customer
 *     }
 * }
 * ```
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export async function assertCustomFieldsWritable(
    ctx: RequestContext,
    injector: Injector,
    entityName: keyof CustomFields,
    input: Record<string, unknown> | undefined,
    options: { translation?: boolean } = {},
): Promise<void> {
    if (input === undefined) {
        return;
    }
    const configs: CustomFieldConfig[] = injector.get(ConfigService).customFields[entityName] ?? [];
    const inTranslation = options.translation === true;
    const notWritable: string[] = [];
    const misplaced: string[] = [];
    const toValidate: Array<{ config: CustomFieldConfig; value: unknown }> = [];

    for (const [key, value] of Object.entries(input)) {
        // Matched like core's interceptor: a relation field arrives as `<name>Id` or `<name>Ids`.
        const config = configs.find(candidate => getGraphQlInputName(candidate) === key);
        if (!config || !isWritableBy(ctx, config)) {
            notWritable.push(key);
        } else if (isLocalizedCustomFieldType(config.type) !== inTranslation) {
            misplaced.push(key);
        } else {
            toValidate.push({ config, value });
        }
    }
    if (notWritable.length > 0) {
        throw new UserInputError(
            `These custom fields cannot be set on ${entityName}: ${notWritable.join(', ')}.`,
        );
    }
    if (misplaced.length > 0) {
        throw new UserInputError(
            inTranslation
                ? `These custom fields are not localized, so they cannot be set on a translation: ${misplaced.join(', ')}.`
                : `These custom fields are localized, so they must be set on a translation: ${misplaced.join(', ')}.`,
        );
    }

    for (const { config, value } of toValidate) {
        await validateCustomFieldValue(config, value, injector, ctx);
    }
}

/** Internal fields are in no API; non-public fields are admin-only. */
function isWritableBy(ctx: RequestContext, config: CustomFieldConfig): boolean {
    if (config.internal === true) {
        return false;
    }
    return !(ctx.apiType === 'shop' && config.public === false);
}
