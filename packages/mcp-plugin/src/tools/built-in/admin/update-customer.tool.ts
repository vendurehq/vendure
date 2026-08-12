import { Injectable } from '@nestjs/common';
import { CustomerService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { customerSummary } from '../serializers';

const customerUpdateSchema = z.strictObject({
    firstName: z.string().describe('Customer first name.').optional(),
    lastName: z.string().describe('Customer last name.').optional(),
    emailAddress: z
        .string()
        .describe('Customer email address.')
        .meta({ format: 'email' })
        .refine(value => z.regexes.email.test(value), 'Invalid email address')
        .optional(),
    phoneNumber: z.string().describe('Customer phone number.').optional(),
    title: z.string().describe('Customer title, e.g. "Mr" or "Ms".').optional(),
    customFields: z.looseObject({}).describe('Customer custom fields.').optional(),
});

const updateCustomerInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Customer ID.'),
    input: customerUpdateSchema,
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
    inputSchema: updateCustomerInput,
})
@Injectable()
export class UpdateCustomerTool implements McpToolHandler<UpdateCustomerToolInput> {
    constructor(private customerService: CustomerService) {}

    async execute(ctx: RequestContext, input: UpdateCustomerToolInput) {
        return {
            customer: customerSummary(
                await this.customerService.update(ctx, { ...input.input, id: input.id }),
            ),
        };
    }
}
