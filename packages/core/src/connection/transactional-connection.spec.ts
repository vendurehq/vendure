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
import { TRANSACTION_MANAGER_KEY } from '../common/constants';

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

    describe('lockRow', () => {
        /** The lock mode lockRow() asks for on the given database, or undefined if it takes none. */
        async function lockModeOn(
            type: string,
            options?: { requireReadCommitted?: boolean },
            defaultIsolationLevel?: string,
        ): Promise<string | undefined> {
            let lockMode: string | undefined;
            const queryBuilder: any = {
                select: () => queryBuilder,
                setLock: (mode: string) => {
                    lockMode = mode;
                    return queryBuilder;
                },
                where: () => queryBuilder,
                getOne: async () => undefined,
            };
            const manager = {
                queryRunner: { isTransactionActive: true },
                getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
            };
            const isMysqlFamily = type === 'mysql' || type === 'mariadb';
            const transactionWrapper = {
                resolveIsolationLevel: () =>
                    defaultIsolationLevel ?? (isMysqlFamily ? 'READ COMMITTED' : undefined),
            };
            const lockingConnection = new TransactionalConnection(
                { options: { type } } as any,
                transactionWrapper as any,
                { authOptions: {} } as any,
            );
            const txCtx = RequestContext.empty();
            (txCtx as any)[TRANSACTION_MANAGER_KEY] = manager;
            await lockingConnection.lockRow(txCtx, TestNode, 1, options);
            return lockMode;
        }

        it('takes FOR NO KEY UPDATE on Postgres and Aurora Postgres', async () => {
            expect(await lockModeOn('postgres')).toBe('for_no_key_update');
            expect(await lockModeOn('aurora-postgres')).toBe('for_no_key_update');
        });

        it('takes FOR UPDATE on MySQL, MariaDB and Aurora MySQL', async () => {
            expect(await lockModeOn('mysql')).toBe('pessimistic_write');
            expect(await lockModeOn('mariadb')).toBe('pessimistic_write');
            expect(await lockModeOn('aurora-mysql')).toBe('pessimistic_write');
        });

        it('takes no lock on SQLite drivers', async () => {
            expect(await lockModeOn('sqljs')).toBeUndefined();
        });

        it('with requireReadCommitted, takes no lock where later reads would miss the previous holder commit', async () => {
            // Aurora MySQL never applies an isolation level, so it always runs at REPEATABLE READ.
            expect(await lockModeOn('aurora-mysql', { requireReadCommitted: true })).toBeUndefined();
            expect(
                await lockModeOn('mysql', { requireReadCommitted: true }, 'REPEATABLE READ'),
            ).toBeUndefined();
            expect(await lockModeOn('mysql', { requireReadCommitted: true })).toBe('pessimistic_write');
            expect(await lockModeOn('postgres', { requireReadCommitted: true })).toBe('for_no_key_update');
        });
    });
});
