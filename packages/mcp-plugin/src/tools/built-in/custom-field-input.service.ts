import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import {
    ConfigService,
    CustomFieldConfig,
    CustomFields,
    Injector,
    RequestContext,
    UserInputError,
    validateCustomFieldValue,
} from '@vendure/core';

/**
 * Checks a tool's `customFields` input before it reaches a Vendure service.
 *
 * The GraphQL API checks custom fields twice: the generated schema only lists the fields the
 * caller may write, and core's interceptor validates each value. Tool calls skip both, so this
 * service does both.
 */
@Injectable()
export class McpCustomFieldInputService {
    constructor(
        private configService: ConfigService,
        private moduleRef: ModuleRef,
    ) {}

    /**
     * Throws when the input names a custom field this caller cannot write, then runs core's own
     * validation (readonly, permissions, nullability, patterns, ranges, the project's `validate`)
     * over the rest. `entityName` is the entity the fields belong to, e.g. `'Product'`.
     */
    async assertWritable(
        ctx: RequestContext,
        entityName: keyof CustomFields,
        input: Record<string, unknown> | undefined,
    ): Promise<void> {
        if (input === undefined) {
            return;
        }
        const configs: CustomFieldConfig[] = this.configService.customFields[entityName] ?? [];
        const notWritable: string[] = [];
        const toValidate: Array<{ config: CustomFieldConfig; value: unknown }> = [];

        for (const [key, value] of Object.entries(input)) {
            // Matched like core's interceptor: a relation field arrives as `<name>Id` or `<name>Ids`.
            const config = configs.find(candidate => getGraphQlInputName(candidate) === key);
            if (config && this.isWritableBy(ctx, config)) {
                toValidate.push({ config, value });
            } else {
                notWritable.push(key);
            }
        }
        if (notWritable.length > 0) {
            throw new UserInputError(
                `These custom fields cannot be set on ${entityName}: ${notWritable.join(', ')}.`,
            );
        }

        const injector = new Injector(this.moduleRef);
        for (const { config, value } of toValidate) {
            await validateCustomFieldValue(config, value, injector, ctx);
        }
    }

    /** Internal fields are in no API; non-public fields are admin-only. */
    private isWritableBy(ctx: RequestContext, config: CustomFieldConfig): boolean {
        if (config.internal === true) {
            return false;
        }
        return !(ctx.apiType === 'shop' && config.public === false);
    }
}
