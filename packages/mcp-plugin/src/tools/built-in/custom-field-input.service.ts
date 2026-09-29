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

// Tool calls bypass the two checks the GraphQL API normally applies to custom fields, so this
// service does both of them instead.
@Injectable()
export class McpCustomFieldInputService {
    constructor(
        private readonly configService: ConfigService,
        private readonly moduleRef: ModuleRef,
    ) {}

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
