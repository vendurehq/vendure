import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { JobRecord } from './job-record.entity';

describe('JobRecord indexes', () => {
    const indexColumns = () =>
        getMetadataArgsStorage()
            .indices.filter(index => index.target === JobRecord)
            .map(index => index.columns);

    it('has a (queueName, state, createdAt) index', () => {
        expect(indexColumns()).toContainEqual(['queueName', 'state', 'createdAt']);
    });

    // #5604: Postgres picks a createdAt-only index for the next() lookup and filters every settled row
    it('has no index on createdAt alone', () => {
        expect(indexColumns()).not.toContainEqual(['createdAt']);
    });
});
