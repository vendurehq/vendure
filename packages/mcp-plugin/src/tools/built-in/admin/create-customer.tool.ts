import { Injectable } from '@nestjs/common';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { emailAddressSchema } from '../email-schema';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

const customerInputSchema = z.strictObject({
    firstName: shortText.describe('Customer first name.'),
    lastName: shortText.describe('Customer last name.'),
    emailAddress: emailAddressSchema,
    phoneNumber: shortText.describe('Customer phone number.').optional(),
    title: shortText.describe('Customer title, e.g. "Mr" or "Ms".').optional(),
    customFields: z.looseObject({}).describe('Customer custom fields.').optional(),
});

const createCustomerInput = z.strictObject({
    input: customerInputSchema,
});

type CreateCustomerToolInput = z.infer<typeof createCustomerInput>;

@McpTool({
    name: 'create_customer',
    toolset: 'admin',
    description: 'Create a new customer record with their name, email address and an optional phone number.',
    keywords: [
        'add a new customer',
        'register a buyer',
        'set up a client account',
        'onboard a new customer',
        'create a shopper record',
        'make a customer account',
    ],
    permissions: [Permission.CreateCustomer],
    behavior: 'mutating',
    inputSchema: createCustomerInput,
})
@Injectable()
export class CreateCustomerTool implements McpToolHandler<CreateCustomerToolInput> {
    constructor(
        private customerService: CustomerService,
        private customFieldInput: McpCustomFieldInputService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateCustomerToolInput) {
        await this.customFieldInput.assertWritable(ctx, 'Customer', input.input.customFields);
        return this.serializer.customerOrError(await this.customerService.create(ctx, input.input));
    }
}
