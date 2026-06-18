import { Injector } from '../../common/injector';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Job } from '../../job-queue/job';
import { JobBufferStorageStrategy } from '../../job-queue/job-buffer/job-buffer-storage-strategy';
import { JobConfig } from '../../job-queue/types';

import { JobRecordBuffer } from './job-record-buffer.entity';

/**
 * @description
 * This stores the buffered jobs in the database.
 */
export class SqlJobBufferStorageStrategy implements JobBufferStorageStrategy {
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }

    async add(bufferId: string, job: Job): Promise<Job> {
        await this.connection.rawConnection.getRepository(JobRecordBuffer).save(
            new JobRecordBuffer({
                bufferId,
                job: this.toJobConfig(job),
            }),
        );

        return job;
    }

    async bufferSize(bufferIds?: string[]): Promise<{ [bufferId: string]: number }> {
        const qb = this.connection.rawConnection
            .getRepository(JobRecordBuffer)
            .createQueryBuilder('record')
            .select('COUNT(*)', 'count')
            .addSelect('record.bufferId', 'bufferId');

        if (bufferIds?.length) {
            qb.andWhere('record.bufferId IN (:...bufferIds)', { bufferIds });
        }

        const rows = await qb.groupBy('record.bufferId').getRawMany();

        const result: { [bufferId: string]: number } = {};
        for (const row of rows) {
            if (bufferIds) result[row.bufferId] = +row.count;
        }
        return result;
    }

    async flush(bufferIds?: string[]): Promise<{ [bufferId: string]: Job[] }> {
        const selectQb = this.connection.rawConnection
            .getRepository(JobRecordBuffer)
            .createQueryBuilder('record');
        if (bufferIds?.length) {
            selectQb.where('record.bufferId IN (:...bufferIds)', { bufferIds });
        }
        const rows = await selectQb.getMany();
        const result: { [bufferId: string]: Job[] } = {};
        for (const row of rows) {
            if (!result[row.bufferId]) {
                result[row.bufferId] = [];
            }
            result[row.bufferId].push(new Job(row.job));
        }
        const deleteQb = this.connection.rawConnection.createQueryBuilder().delete().from(JobRecordBuffer);
        if (bufferIds?.length) {
            deleteQb.where('bufferId IN (:...bufferIds)', { bufferIds });
        }
        await deleteQb.execute();
        return result;
    }

    private toJobConfig(job: Job<any>): JobConfig<any> {
        return {
            queueName: job.queueName,
            data: job.data,
            retries: job.retries,
            attempts: job.attempts,
            state: job.state,
            progress: job.progress,
            result: job.result,
            error: job.error,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            settledAt: job.settledAt,
            id: job.id ?? undefined,
        };
    }
}
