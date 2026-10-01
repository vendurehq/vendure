import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CustomFields, Injector, RequestContext } from '@vendure/core';
import { assertCustomFieldsWritable } from '@vendure/mcp-sdk';

// Lets the built-in tools inject the custom field check instead of each building an Injector.
@Injectable()
export class McpCustomFieldInputService {
    constructor(private readonly moduleRef: ModuleRef) {}

    assertWritable(
        ctx: RequestContext,
        entityName: keyof CustomFields,
        input: Record<string, unknown> | undefined,
    ): Promise<void> {
        return assertCustomFieldsWritable(ctx, new Injector(this.moduleRef), entityName, input);
    }
}
