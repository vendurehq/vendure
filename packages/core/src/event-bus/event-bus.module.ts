import { Module } from '@nestjs/common';

import { ConnectionModule } from '../connection/connection.module';

import { EventBus } from './event-bus';

@Module({
    imports: [ConnectionModule],
    providers: [EventBus],
    exports: [EventBus],
})
export class EventBusModule {}
