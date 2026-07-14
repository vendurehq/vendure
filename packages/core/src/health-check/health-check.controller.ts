import { Controller, Get } from '@nestjs/common';

import { HEALTH_CHECK_ROUTE } from './constants';

@Controller(HEALTH_CHECK_ROUTE)
export class HealthController {
    @Get()
    check() {
        return { status: 'ok' };
    }
}
