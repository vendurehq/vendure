import { Injectable } from '@nestjs/common';
import { ID, Product, RequestContext, TransactionalConnection } from '@vendure/core';

@Injectable()
export class BasicServiceTemplate {
    constructor(private connection: TransactionalConnection) {}

    async exampleMethod(ctx: RequestContext, id: ID) {
        // Add your method logic here
        const result = await this.connection.getRepository(ctx, Product).findOne({ where: { id } });
        return result;
    }
}
