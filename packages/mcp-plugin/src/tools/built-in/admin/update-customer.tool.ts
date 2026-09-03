import { Injectable } from '@nestjs/common';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

import { customerFieldsSchema } from './entity-field-schemas';

const updateCustomerInput = z.strictObject({
    id: idSchema.describe('Customer ID.'),
    input: customerFieldsSchema.partial(),
});

type UpdateCustomerToolInput = z.infer<typeof updateCustomerInput>;

@McpTool({
    name: 'update_customer',
    toolset: 'admin',
    description: "Update an existing customer's details, such as their name, email address or phone number.",
    keywords: [
        "edit a customer's details",
        "change a client's info",
        "fix a buyer's record",
        'modify customer data',
        "update someone's account details",
        'correct a customer profile',
    ],
    permissions: [Permission.UpdateCustomer],
    behavior: 'mutating',
    inputSchema: updateCustomerInput,
})
@Injectable()
export class UpdateCustomerTool implements McpToolHandler<UpdateCustomerToolInput> {
    constructor(
        private customerService: CustomerService,
        private customFieldInput: McpCustomFieldInputService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateCustomerToolInput) {
        await this.customFieldInput.assertWritable(ctx, 'Customer', input.input.customFields);
        return this.serializer.customerOrError(
            await this.customerService.update(ctx, { ...input.input, id: input.id }),
        );
    }
}
