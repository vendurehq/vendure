import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';

import { JobBufferService } from './job-buffer/job-buffer.service';
import { JobQueueService } from './job-queue.service';

@Module({
    imports: [ConfigModule],
    providers: [JobQueueService, JobBufferService],
    exports: [JobQueueService, JobBufferService],
})
export class JobQueueModule {}
