import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import {
    Ctx,
    Customer,
    CustomerService,
    HasCustomFields,
    ListQueryBuilder,
    LocaleString,
    Order,
    OrderService,
    PluginCommonModule,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    Translatable,
    translateDeep,
    Translation,
    VendureEntity,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';
import {
    Column,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToMany,
    OneToOne,
    Relation,
} from 'typeorm';

import { Calculated } from '../../../src/common/calculated-decorator';

@Entity()
export class CustomFieldRelationTestEntity extends VendureEntity {
    constructor(input: Partial<CustomFieldRelationTestEntity>) {
        super(input);
    }

    @Column()
    data: string;

    @ManyToOne(() => TestEntity, testEntity => testEntity.customFields.relation)
    parent: Relation<TestEntity>;
}

@Entity()
export class CustomFieldOtherRelationTestEntity extends VendureEntity {
    constructor(input: Partial<CustomFieldOtherRelationTestEntity>) {
        super(input);
    }

    @Column()
    data: string;

    @ManyToOne(() => TestEntity, testEntity => testEntity.customFields.otherRelation)
    parent: Relation<TestEntity>;
}

/**
 * Entity used to test ManyToMany relations with customPropertyMap
 * for the duplicate filter fix (GitHub issue #3267)
 */
@Entity()
export class TestEntityTag extends VendureEntity {
    constructor(input: Partial<TestEntityTag>) {
        super(input);
    }

    @Column()
    name: string;

    @Column({ default: 0 })
    priority: number;

    @ManyToMany(() => TestEntity, testEntity => testEntity.tags)
    testEntities: Relation<TestEntity[]>;
}

class TestEntityCustomFields {
    @OneToMany(() => CustomFieldRelationTestEntity, child => child.parent)
    relation: Relation<CustomFieldRelationTestEntity[]>;

    @OneToMany(() => CustomFieldOtherRelationTestEntity, child => child.parent)
    otherRelation: Relation<CustomFieldOtherRelationTestEntity[]>;
}

@Entity()
export class TestEntity extends VendureEntity implements Translatable, HasCustomFields {
    constructor(input: Partial<TestEntity>) {
        super(input);
    }

    @Column()
    label: string;

    name: LocaleString;

    @Column()
    description: string;

    @Column()
    active: boolean;

    @Column()
    order: number;

    @Column('varchar')
    ownerId: ID;

    @Column()
    date: Date;

    @Calculated({
        query: qb =>
            qb
                .leftJoin(
                    qb1 => {
                        return qb1
                            .from(TestEntity, 'entity')
                            .select('LENGTH(entity.description)', 'deslen')
                            .addSelect('entity.id', 'eid');
                    },
                    't1',
                    't1.eid = testentity.id',
                )
                .addSelect('t1.deslen', 'deslen'),
        expression: 'deslen',
    })
    get descriptionLength() {
        return this.description.length || 0;
    }

    @Calculated({
        relations: ['prices'],
        expression: 'prices.price',
    })
    get price() {
        return this.activePrice;
    }

    // calculated at runtime
    activePrice: number;

    @OneToMany(type => TestEntityPrice, price => price.parent)
    prices: TestEntityPrice[];

    @OneToMany(type => TestEntityTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<TestEntity>>;

    @OneToOne(type => Order)
    @JoinColumn()
    orderRelation: Order;

    @Column({ nullable: true })
    nullableString: string;

    @Column({ nullable: true })
    nullableBoolean: boolean;

    @Column({ nullable: true })
    nullableNumber: number;

    @Column('varchar', { nullable: true })
    nullableId: ID;

    @Column({ nullable: true })
    nullableDate: Date;

    @Column(() => TestEntityCustomFields)
    customFields: TestEntityCustomFields;

    @ManyToOne(() => TestEntity, type => type.parent)
    parent: TestEntity | null;

    @Column('int', { nullable: true })
    parentId: ID | null;

    @ManyToMany(() => TestEntityTag, tag => tag.testEntities)
    @JoinTable()
    tags: Relation<TestEntityTag[]>;
}

@Entity()
export class TestEntityTranslation extends VendureEntity implements Translation<TestEntity> {
    constructor(input?: DeepPartial<Translation<TestEntity>>) {
        super(input);
    }

    @Column('varchar') languageCode: LanguageCode;

    @Column() name: string;

    @ManyToOne(type => TestEntity, base => base.translations)
    base: TestEntity;

    customFields: never;
}

@Entity()
export class TestEntityPrice extends VendureEntity {
    constructor(input: Partial<TestEntityPrice>) {
        super(input);
    }

    @Column()
    channelId: number;

    @Column()
    price: number;

    @ManyToOne(type => TestEntity, parent => parent.prices)
    parent: TestEntity;
}

@Resolver()
export class ListQueryResolver {
    constructor(private listQueryBuilder: ListQueryBuilder) {}

    @Query()
    testEntities(@Ctx() ctx: RequestContext, @Args() args: any) {
        return this.listQueryBuilder
            .build(TestEntity, args.options, {
                ctx,
                relations: [
                    'parent',
                    'orderRelation',
                    'orderRelation.customer',
                    'customFields.relation',
                    'customFields.otherRelation',
                    'tags',
                ],
                customPropertyMap: {
                    customerLastName: 'orderRelation.customer.lastName',
                    tagId: 'tags.id',
                    tagPriority: 'tags.priority',
                },
            })
            .getManyAndCount()
            .then(([items, totalItems]) => {
                for (const item of items) {
                    if (item.prices && item.prices.length) {
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        item.activePrice = item.prices.find(p => p.channelId === 1)!.price;
                    }
                }
                return {
                    items: items.map(i => translateDeep(i, ctx.languageCode, ['parent'])),
                    totalItems,
                };
            });
    }

    @Query()
    testEntitiesGetMany(@Ctx() ctx: RequestContext, @Args() args: any) {
        return this.listQueryBuilder
            .build(TestEntity, args.options, { ctx, relations: ['prices', 'parent'] })
            .getMany()
            .then(items => {
                for (const item of items) {
                    if (item.prices && item.prices.length) {
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        item.activePrice = item.prices.find(p => p.channelId === 1)!.price;
                    }
                }
                return items.map(i => translateDeep(i, ctx.languageCode, ['parent']));
            });
    }
}

const apiExtensions = gql`
    type TestEntityTranslation implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        languageCode: LanguageCode!
        name: String!
    }

    type CustomFieldRelationTestEntity implements Node {
        id: ID!
        data: String!
    }

    type CustomFieldOtherRelationTestEntity implements Node {
        id: ID!
        data: String!
    }

    type TestEntityCustomFields {
        relation: [CustomFieldRelationTestEntity!]!
        otherRelation: [CustomFieldOtherRelationTestEntity!]!
    }

    type TestEntity implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        label: String!
        name: String!
        description: String!
        active: Boolean!
        order: Int!
        date: DateTime!
        descriptionLength: Int!
        price: Int!
        ownerId: ID!
        translations: [TestEntityTranslation!]!
        orderRelation: Order
        nullableString: String
        nullableBoolean: Boolean
        nullableNumber: Int
        nullableId: ID
        nullableDate: DateTime
        customFields: TestEntityCustomFields!
        parent: TestEntity
        tags: [TestEntityTag!]!
    }

    type TestEntityTag implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        priority: Int!
    }

    type TestEntityList implements PaginatedList {
        totalItems: Int!
        items: [TestEntity!]!
    }

    extend type Query {
        testEntities(options: TestEntityListOptions): TestEntityList!
        testEntitiesGetMany(options: TestEntityListOptions): [TestEntity!]!
    }

    input TestEntityFilterParameter {
        customerLastName: StringOperators
        tagId: IDOperators
        tagPriority: NumberOperators
    }

    input TestEntitySortParameter {
        customerLastName: SortOrder
    }

    input TestEntityListOptions
`;

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [
        TestEntity,
        TestEntityPrice,
        TestEntityTranslation,
        TestEntityTag,
        CustomFieldRelationTestEntity,
        CustomFieldOtherRelationTestEntity,
    ],
    adminApiExtensions: {
        schema: apiExtensions,
        resolvers: [ListQueryResolver],
    },
    shopApiExtensions: {
        schema: apiExtensions,
        resolvers: [ListQueryResolver],
    },
})
export class ListQueryPlugin implements OnApplicationBootstrap {
    constructor(
        private connection: TransactionalConnection,
        private requestContextService: RequestContextService,
        private customerService: CustomerService,
        private orderService: OrderService,
    ) {}

    async onApplicationBootstrap() {
        const count = await this.connection.rawConnection.getRepository(TestEntity).count();
        if (count === 0) {
            const testEntities = await this.connection.rawConnection.getRepository(TestEntity).save([
                new TestEntity({
                    label: 'A',
                    description: 'Lorem ipsum', // 11
                    date: new Date('2020-01-05T10:00:00.000Z'),
                    active: true,
                    order: 0,
                    ownerId: 10,
                    nullableString: 'lorem',
                    nullableBoolean: true,
                    nullableNumber: 42,
                    nullableId: 123,
                    nullableDate: new Date('2022-01-05T10:00:00.000Z'),
                }),
                new TestEntity({
                    label: 'B',
                    description: 'dolor sit', // 9
                    date: new Date('2020-01-15T10:00:00.000Z'),
                    active: true,
                    order: 1,
                    ownerId: 11,
                }),
                new TestEntity({
                    label: 'C',
                    description: 'consectetur adipiscing', // 22
                    date: new Date('2020-01-25T10:00:00.000Z'),
                    active: false,
                    order: 2,
                    ownerId: 12,
                    nullableString: 'lorem',
                    nullableBoolean: true,
                    nullableNumber: 42,
                    nullableId: 123,
                    nullableDate: new Date('2022-01-05T10:00:00.000Z'),
                }),
                new TestEntity({
                    label: 'D',
                    description: 'eiusmod tempor', // 14
                    date: new Date('2020-01-30T10:00:00.000Z'),
                    active: true,
                    order: 3,
                    ownerId: 13,
                }),
                new TestEntity({
                    label: 'E',
                    description: 'incididunt ut', // 13
                    date: new Date('2020-02-05T10:00:00.000Z'),
                    active: false,
                    order: 4,
                    ownerId: 14,
                    nullableString: 'lorem',
                    nullableBoolean: true,
                    nullableNumber: 42,
                    nullableId: 123,
                    nullableDate: new Date('2022-01-05T10:00:00.000Z'),
                }),
                new TestEntity({
                    label: 'F',
                    description: 'quis nostrud exercitation ullamco', // 33
                    date: new Date('2020-02-07T10:00:00.000Z'),
                    active: false,
                    order: 5,
                    ownerId: 15,
                }),
            ]);

            // test entity with self-referencing relation without tree structure decorator
            testEntities[0].parent = testEntities[1];
            testEntities[3].parent = testEntities[1];
            await this.connection.rawConnection
                .getRepository(TestEntity)
                .save([testEntities[0], testEntities[3]]);

            const translations: any = {
                A: { [LanguageCode.en]: 'apple', [LanguageCode.de]: 'apfel' },
                B: { [LanguageCode.en]: 'bike', [LanguageCode.de]: 'fahrrad' },
                C: { [LanguageCode.en]: 'cake', [LanguageCode.de]: 'kuchen' },
                D: { [LanguageCode.en]: 'dog', [LanguageCode.de]: 'hund' },
                E: { [LanguageCode.en]: 'egg' },
                F: { [LanguageCode.de]: 'baum' },
            };

            const nestedData: Record<string, Array<{ data: string }>> = {
                A: [{ data: 'A' }],
                B: [{ data: 'B' }],
                C: [{ data: 'C' }],
            };

            // Create tags for testing ManyToMany filtering with duplicate fields in _and blocks
            // This tests the fix for GitHub issue #3267
            // Priority values: tag1=10, tag2=20, tag3=30 (for testing BETWEEN operator)
            const tags = await this.connection.rawConnection
                .getRepository(TestEntityTag)
                .save([
                    new TestEntityTag({ name: 'tag1', priority: 10 }),
                    new TestEntityTag({ name: 'tag2', priority: 20 }),
                    new TestEntityTag({ name: 'tag3', priority: 30 }),
                ]);

            // Assign tags to test entities:
            // A: tag1, tag2     (both tags)
            // B: tag1, tag2     (both tags)
            // C: tag1           (only tag1)
            // D: tag2           (only tag2)
            // E: tag1, tag2, tag3 (all tags)
            // F: (no tags)
            const entityTagAssignments: Record<string, string[]> = {
                A: ['tag1', 'tag2'],
                B: ['tag1', 'tag2'],
                C: ['tag1'],
                D: ['tag2'],
                E: ['tag1', 'tag2', 'tag3'],
                F: [],
            };

            for (const testEntity of testEntities) {
                const tagNames = entityTagAssignments[testEntity.label] || [];
                testEntity.tags = tags.filter(t => tagNames.includes(t.name));
            }
            await this.connection.rawConnection.getRepository(TestEntity).save(testEntities);

            for (const testEntity of testEntities) {
                await this.connection.rawConnection.getRepository(TestEntityPrice).save([
                    new TestEntityPrice({
                        price: testEntity.description.length,
                        channelId: 1,
                        parent: testEntity,
                    }),
                    new TestEntityPrice({
                        price: testEntity.description.length * 100,
                        channelId: 2,
                        parent: testEntity,
                    }),
                ]);

                for (const code of [LanguageCode.en, LanguageCode.de]) {
                    const translation = translations[testEntity.label][code];
                    if (translation) {
                        await this.connection.rawConnection.getRepository(TestEntityTranslation).save(
                            new TestEntityTranslation({
                                name: translation,
                                base: testEntity,
                                languageCode: code,
                            }),
                        );
                    }
                }

                if (nestedData[testEntity.label]) {
                    for (const nestedContent of nestedData[testEntity.label]) {
                        await this.connection.rawConnection.getRepository(CustomFieldRelationTestEntity).save(
                            new CustomFieldRelationTestEntity({
                                parent: testEntity,
                                data: nestedContent.data,
                            }),
                        );
                        await this.connection.rawConnection
                            .getRepository(CustomFieldOtherRelationTestEntity)
                            .save(
                                new CustomFieldOtherRelationTestEntity({
                                    parent: testEntity,
                                    data: nestedContent.data,
                                }),
                            );
                    }
                }
            }
        } else {
            const testEntities = await this.connection.rawConnection.getRepository(TestEntity).find();
            const ctx = await this.requestContextService.create({ apiType: 'admin' });
            const customers = await this.connection.rawConnection.getRepository(Customer).find();
            let i = 0;

            for (const testEntity of testEntities) {
                const customer = customers[i % customers.length];
                try {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const order = await this.orderService.create(ctx, customer.user!.id);
                    testEntity.orderRelation = order;
                    await this.connection.rawConnection.getRepository(TestEntity).save(testEntity);
                } catch (e: any) {
                    Logger.error(e);
                }
                i++;
            }
        }
    }
}
