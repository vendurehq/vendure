import { DeepPartial } from '@vendure/common/lib/shared-types';
import { describe, expect, it } from 'vitest';

import { Calculated } from '../../common/index';
import { CalculatedPropertySubscriber } from '../subscribers';

import { VendureEntity } from './base.entity';

class ChildEntity extends VendureEntity {
    constructor(input?: DeepPartial<ChildEntity>) {
        super(input);
    }

    name: string;

    get nameLoud(): string {
        return this.name.toUpperCase();
    }
}

class ChildEntityWithCalculated extends VendureEntity {
    constructor(input?: DeepPartial<ChildEntity>) {
        super(input);
    }

    name: string;

    @Calculated()
    get nameLoudCalculated(): string {
        return this.name.toUpperCase();
    }
}

describe('VendureEntity', () => {
    it('instantiating a child entity', () => {
        const child = new ChildEntity({
            name: 'foo',
        });

        expect(child.name).toBe('foo');
        expect(child.nameLoud).toBe('FOO');
    });

    it('instantiating from existing entity with getter', () => {
        const child1 = new ChildEntity({
            name: 'foo',
        });

        const child2 = new ChildEntity(child1);

        expect(child2.name).toBe('foo');
        expect(child2.nameLoud).toBe('FOO');
    });

    it('instantiating from existing entity with calculated getter', () => {
        const calculatedPropertySubscriber = new CalculatedPropertySubscriber();
        const child1 = new ChildEntityWithCalculated({
            name: 'foo',
        });

        // This is what happens to entities after being loaded from the DB
        calculatedPropertySubscriber.afterLoad(child1);

        const child2 = new ChildEntityWithCalculated(child1);

        expect(child2.name).toBe('foo');
        expect(child2.nameLoudCalculated).toBe('FOO');
    });
});
