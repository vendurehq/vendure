import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/index';

import { SchedulerService } from './scheduler.service';

@Module({
    imports: [ConfigModule],
    providers: [SchedulerService],
    exports: [SchedulerService],
})
export class SchedulerModule {}
