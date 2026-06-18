// product-review.entity.ts
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity, VendurePlugin } from '@vendure/core';
import { Column, Entity } from 'typeorm';

@Entity()
export class TestEntityA extends VendureEntity {
    constructor(input?: DeepPartial<TestEntityA>) {
        super(input);
    }

    @Column()
    textA: string;
}

@Entity()
export class TestEntityB extends VendureEntity {
    constructor(input?: DeepPartial<TestEntityA>) {
        super(input);
    }

    @Column()
    textB: string;
}

@VendurePlugin({
    entities: () => {
        return DynamicEntitiesPlugin.useEntity === 'A' ? [TestEntityA] : [TestEntityB];
    },
})
export class DynamicEntitiesPlugin {
    static useEntity: 'A' | 'B';
    static init(options: { useEntity: 'A' | 'B' }) {
        this.useEntity = options.useEntity;
        return this;
    }
}
