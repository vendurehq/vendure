import { Controller, Get } from '@nestjs/common';
import { Ctx, PluginCommonModule, ProductService, RequestContext, VendurePlugin } from '@vendure/core';

@Controller('products')
export class ProductsController {
    constructor(private productService: ProductService) {}

    @Get()
    findAll(@Ctx() ctx: RequestContext) {
        return this.productService.findAll(ctx);
    }
}

/**
 * A proof-of-concept plugin which adds a REST endpoint for querying products.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [ProductsController],
})
export class RestPlugin {}
