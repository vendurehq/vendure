import {
    DataSource,
    Entity,
    JoinTable,
    Logger,
    ManyToMany,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RequestContext } from '../api/common/request-context';

import { TransactionalConnection } from './transactional-connection';
import { FindOptionsRelationsInput } from './types';

@Entity()
class TestChannel {
    @PrimaryGeneratedColumn()
    id: number;
}

/**
 * A self-referencing, channel-aware entity. `joinTreeRelationsDynamically` joins
 * self-referencing relations manually, which is the behaviour these tests cover.
 */
@Entity()
class TestNode {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => TestNode, node => node.children, { nullable: true })
    parent: TestNode | null;

    @OneToMany(() => TestNode, node => node.parent)
    children: TestNode[];

    @ManyToMany(() => TestChannel)
    @JoinTable()
    channels: TestChannel[];
}

describe('TransactionalConnection', () => {
    let executedQueries: string[] = [];
    const noop = () => undefined;
    const queryLogger: Logger = {
        logQuery: query => executedQueries.push(query),
        logQueryError: noop,
        logQuerySlow: noop,
        logSchemaBuild: noop,
        logMigration: noop,
        log: noop,
    };
    let dataSource: DataSource;
    let connection: TransactionalConnection;
    let ctx: RequestContext;

    beforeAll(async () => {
        dataSource = new DataSource({
            type: 'sqljs',
            entities: [TestNode, TestChannel],
            synchronize: true,
            logger: queryLogger,
        });
        await dataSource.initialize();
        connection = new TransactionalConnection(dataSource, {} as any, { authOptions: {} } as any);
        ctx = RequestContext.empty();
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    describe('findByIdsInChannel', () => {
        async function collectQueriesFor(relations: FindOptionsRelationsInput<TestNode>): Promise<string[]> {
            executedQueries = [];
            await connection.findByIdsInChannel(ctx, TestNode as any, [1], 1, { relations });
            return executedQueries;
        }

        // Object-form relations must take the same tree-relation join path as the array
        // form, rather than falling through to TypeORM's own relation loading.
        it('joins self-referencing relations given in object form', async () => {
            const queries = await collectQueriesFor({ parent: true });

            expect(queries).toHaveLength(1);
            expect(queries[0]).toContain('LEFT JOIN "test_node" "entity_parent"');
        });

        it('produces the same queries for array and object relations', async () => {
            const arrayForm = await collectQueriesFor(['parent']);
            const objectForm = await collectQueriesFor({ parent: true });

            expect(objectForm).toEqual(arrayForm);
        });
    });
});
