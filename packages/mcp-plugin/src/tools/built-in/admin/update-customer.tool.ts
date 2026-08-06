import { Injectable } from '@nestjs/common';
import { UpdateCustomerInput } from '@vendure/common/lib/generated-types';
import { CustomerService, ID, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { idProp, jsonObjectProp, objectSchema, optional, stringProp } from '../schema-helpers';
import { customerSummary } from '../serializers';

interface UpdateCustomerToolInput {
    id: ID;
    input: Omit<UpdateCustomerInput, 'id'>;
}

const customerUpdateSchema = objectSchema({
    firstName: optional(stringProp('Customer first name.')),
    lastName: optional(stringProp('Customer last name.')),
    emailAddress: optional({ ...stringProp('Customer email address.'), format: 'email' }),
    phoneNumber: optional(stringProp('Customer phone number.')),
    title: optional(stringProp('Customer title, e.g. "Mr" or "Ms".')),
    customFields: optional(jsonObjectProp('Customer custom fields.')),
});

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
    inputSchema: objectSchema({
        id: idProp('Customer ID.'),
        input: customerUpdateSchema,
    }),
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
