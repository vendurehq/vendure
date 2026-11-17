import { DataSource } from 'typeorm';
import { RelationIdLoader } from 'typeorm/query-builder/RelationIdLoader';
import { describe, expect, it } from 'vitest';

import { getDataSource } from './get-data-source';

describe('getDataSource()', () => {
    const dataSource = {} as DataSource;

    it('reads the "connection" property', () => {
        expect(getDataSource({ connection: dataSource })).toBe(dataSource);
    });

    it('reads the "dataSource" property', () => {
        expect(getDataSource({ dataSource })).toBe(dataSource);
    });

    it('prefers "dataSource" when both are present', () => {
        const deprecatedAlias = {} as DataSource;
        expect(getDataSource({ dataSource, connection: deprecatedAlias })).toBe(dataSource);
    });

    it('throws when neither property is present', () => {
        expect(() => getDataSource({})).toThrowError(/Could not resolve a TypeORM DataSource/);
    });

    // Callers reached from untyped code, such as the RelationIdLoader patch, can pass a value the
    // compiler never checked.
    it.each([null, undefined])('throws when given %s', value => {
        expect(() => getDataSource(value as any)).toThrowError(/Could not resolve a TypeORM DataSource/);
    });

    // The RelationIdLoader patch in entity/typeorm-relation-id-loader-fix.ts reads the DataSource
    // off a RelationIdLoader instance, whose field is private and renamed between TypeORM versions.
    // Nothing in that patch is visible to the compiler, so this is the only check that it resolves
    // against the version of TypeORM actually installed.
    it('reads the DataSource from a TypeORM RelationIdLoader', () => {
        const loader = new (RelationIdLoader as any)(dataSource);
        expect(getDataSource(loader)).toBe(dataSource);
    });
});
