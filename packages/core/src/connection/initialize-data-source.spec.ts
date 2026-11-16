import { EventEmitter } from 'events';
import { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { pinMysqlSessionTimezone } from './initialize-data-source';

function fakeMysqlDataSource(timezone?: string) {
    const pools: EventEmitter[] = [];
    const createPool = () => {
        const pool = new EventEmitter();
        pools.push(pool);
        return pool;
    };
    // Shaped like mysql2's PoolCluster, which creates its member pools in add()
    const createPoolCluster = () => {
        const cluster: any = new EventEmitter();
        cluster._nodes = {};
        cluster.add = (id: string) => {
            cluster._nodes[id] = { id, pool: createPool() };
        };
        return cluster;
    };
    const dataSource = {
        options: { type: 'mysql', timezone },
        driver: { mysql: { createPool, createPoolCluster } },
    } as unknown as DataSource;
    return { dataSource, pools };
}

function connect(pool: EventEmitter) {
    const connection = { query: vi.fn() };
    pool.emit('connection', connection);
    return connection;
}

describe('pinMysqlSessionTimezone()', () => {
    it('sets the session time_zone on each new pooled connection', () => {
        const { dataSource, pools } = fakeMysqlDataSource('Z');
        pinMysqlSessionTimezone(dataSource);
        (dataSource.driver as any).mysql.createPool({});
        const connection = connect(pools[0]);
        expect(connection.query).toHaveBeenCalledWith("SET time_zone = '+00:00'", expect.any(Function));
    });

    it('also hooks the pools of a replication cluster', () => {
        const { dataSource, pools } = fakeMysqlDataSource('Z');
        pinMysqlSessionTimezone(dataSource);
        const cluster = (dataSource.driver as any).mysql.createPoolCluster({});
        cluster.add('MASTER', {});
        cluster.add('SLAVE0', {});
        expect(pools).toHaveLength(2);
        for (const pool of pools) {
            expect(connect(pool).query).toHaveBeenCalledWith(
                "SET time_zone = '+00:00'",
                expect.any(Function),
            );
        }
    });

    it('leaves the session alone when the driver writes local time', () => {
        const { dataSource, pools } = fakeMysqlDataSource('local');
        pinMysqlSessionTimezone(dataSource);
        (dataSource.driver as any).mysql.createPool({});
        expect(connect(pools[0]).query).not.toHaveBeenCalled();
    });
});
