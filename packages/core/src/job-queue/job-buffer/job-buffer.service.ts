import { Injectable } from '@nestjs/common';

import { InternalServerError } from '../../common/error/errors';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { Job } from '../job';

import { JobBuffer } from './job-buffer';
import { JobBufferStorageStrategy } from './job-buffer-storage-strategy';

/**
 * @description
 * Used to manage {@link JobBuffer}s.Primarily intended to be used internally by the {@link JobQueueService}, which
 * exposes its public-facing functionality.
 */
@Injectable()
export class JobBufferService {
    private buffers = new Set<JobBuffer>();
    private storageStrategy: JobBufferStorageStrategy;

    constructor(private configService: ConfigService) {
        this.storageStrategy = configService.jobQueueOptions.jobBufferStorageStrategy;
    }

    addBuffer(buffer: JobBuffer<any>) {
        const idAlreadyExists = Array.from(this.buffers).find(p => p.id === buffer.id);
        if (idAlreadyExists) {
            throw new InternalServerError(
                `There is already a JobBufferProcessor with the id "${buffer.id}". Ids must be unique`,
            );
        }
        this.buffers.add(buffer);
    }

    removeBuffer(buffer: JobBuffer<any>) {
        this.buffers.delete(buffer);
    }

    async add(job: Job): Promise<boolean> {
        let collected = false;
        for (const buffer of this.buffers) {
            const shouldCollect = await buffer.collect(job);
            if (shouldCollect) {
                collected = true;
                await this.storageStrategy.add(buffer.id, job);
            }
        }
        return collected;
    }

    bufferSize(forBuffers?: Array<JobBuffer | string>): Promise<{ [bufferId: string]: number }> {
        const buffer = forBuffers ?? Array.from(this.buffers);
        return this.storageStrategy.bufferSize(buffer.map(p => (typeof p === 'string' ? p : p.id)));
    }

    async flush(forBuffers?: Array<JobBuffer | string>): Promise<Job[]> {
        const { jobQueueStrategy } = this.configService.jobQueueOptions;
        const buffers = forBuffers ?? Array.from(this.buffers);
        const flushResult = await this.storageStrategy.flush(
            buffers.map(p => (typeof p === 'string' ? p : p.id)),
        );
        const result: Job[] = [];
        for (const buffer of this.buffers) {
            const jobsForBuffer = flushResult[buffer.id];
            if (jobsForBuffer?.length) {
                let jobsToAdd = jobsForBuffer;
                try {
                    jobsToAdd = await buffer.reduce(jobsForBuffer);
                } catch (e: any) {
                    Logger.error(
                        `Error encountered processing jobs in JobBuffer "${buffer.id}":\n${JSON.stringify(
                            e.message,
                        )}`,
                        undefined,
                        e.stack,
                    );
                }
                for (const job of jobsToAdd) {
                    result.push(await jobQueueStrategy.add(job));
                }
            }
        }
        return result;
    }
}
