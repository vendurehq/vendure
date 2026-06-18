import { Controller, Get } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-shop-types';
import { Allow, InternalServerError, VendurePlugin } from '@vendure/core';

@Controller('test')
export class TestController {
    @Get('public')
    publicRoute() {
        return 'success';
    }

    @Allow(Permission.Authenticated)
    @Get('restricted')
    restrictedRoute() {
        return 'success';
    }

    @Get('bad')
    badRoute() {
        throw new InternalServerError('uh oh!');
    }
}

@VendurePlugin({
    controllers: [TestController],
})
export class TestRestPlugin {}
