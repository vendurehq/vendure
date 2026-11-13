import 'reflect-metadata';
import { Column, CreateDateColumn, Entity, getMetadataArgsStorage, PrimaryGeneratedColumn } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { isConvertedTimestampColumn, setTimestampColumnTypes } from './set-timestamp-column-types';

class Base {
    @PrimaryGeneratedColumn() id: number;
    @CreateDateColumn() createdAt: Date;
}

@Entity()
class Probe extends Base {
    @Column({ type: Date, nullable: true }) placedAt: Date | null;
    @Column({ type: 'timestamptz', nullable: true }) alreadyTz: Date | null;
    @Column({ type: 'timestamp', nullable: true }) explicitTimestamp: Date | null;
    @Column({ nullable: true }) name: string;
}

function typeOf(target: Function, property: string) {
    return getMetadataArgsStorage().columns.find(c => c.target === target && c.propertyName === property)?.options
        .type;
}

const pg = (timestampColumnType?: 'timestamptz' | 'timestamp') =>
    ({ dbConnectionOptions: { type: 'postgres' }, entityOptions: { timestampColumnType } }) as any;

describe('setTimestampColumnTypes()', () => {
    it('converts implicit and Date-typed columns on postgres, and records them', () => {
        setTimestampColumnTypes(pg(), [Probe]);
        expect(typeOf(Base, 'createdAt')).toBe('timestamptz');
        expect(typeOf(Probe, 'placedAt')).toBe('timestamptz');
        expect(typeOf(Probe, 'explicitTimestamp')).toBe('timestamp');
        expect(typeOf(Probe, 'alreadyTz')).toBe('timestamptz');
        expect(isConvertedTimestampColumn(Base, 'createdAt')).toBe(true);
        expect(isConvertedTimestampColumn(Probe, 'placedAt')).toBe(true);
        expect(isConvertedTimestampColumn(Probe, 'alreadyTz')).toBe(false);
        expect(isConvertedTimestampColumn(Probe, 'explicitTimestamp')).toBe(false);
    });

    it('restores the original types for other databases in the same process', () => {
        setTimestampColumnTypes(pg(), [Probe]);
        setTimestampColumnTypes({ dbConnectionOptions: { type: 'mysql' }, entityOptions: {} } as any, [Probe]);
        expect(typeOf(Base, 'createdAt')).toBeUndefined();
        expect(typeOf(Probe, 'placedAt')).toBe(Date);
        expect(typeOf(Probe, 'alreadyTz')).toBe('timestamptz');
        expect(isConvertedTimestampColumn(Probe, 'placedAt')).toBe(false);
    });

    it("keeps the original types with timestampColumnType 'timestamp'", () => {
        setTimestampColumnTypes(pg(), [Probe]);
        setTimestampColumnTypes(pg('timestamp'), [Probe]);
        expect(typeOf(Probe, 'placedAt')).toBe(Date);
        expect(isConvertedTimestampColumn(Probe, 'placedAt')).toBe(false);
    });

    it('treats aurora-postgres like postgres', () => {
        setTimestampColumnTypes({ dbConnectionOptions: { type: 'aurora-postgres' }, entityOptions: {} } as any, [Probe]);
        expect(typeOf(Probe, 'placedAt')).toBe('timestamptz');
    });
});
