import { OnApplicationBootstrap } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    Channel,
    Ctx,
    PluginCommonModule,
    Product,
    RequestContext,
    TransactionalConnection,
    User,
    VendureEntity,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';
import { Entity, JoinColumn, OneToOne } from 'typeorm';
import { vi } from 'vitest';

import { ProfileAsset } from './profile-asset.entity';
import { Profile } from './profile.entity';

@Entity()
export class Vendor extends VendureEntity {
    constructor() {
        super();
    }

    @OneToOne(type => Product, { eager: true })
    @JoinColumn()
    featuredProduct: Product;
}

@Resolver()
class TestResolver1636 {
    constructor(private connection: TransactionalConnection) {}

    @Query()
    async getAssetTest(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        const asset = await this.connection.findOneInChannel(ctx, Asset, args.id, ctx.channelId, {
            relations: ['customFields.single', 'customFields.multi'],
        });
        TestPlugin1636_1664.testResolverSpy(asset);
        return true;
    }
}

const profileType = gql`
    type Profile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        user: User!
    }
`;

/**
 * Testing https://github.com/vendurehq/vendure/issues/1636
 *
 * and
 *
 * https://github.com/vendurehq/vendure/issues/1664
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [Vendor, Profile, ProfileAsset],
    shopApiExtensions: {
        schema: gql`
            extend type Query {
                getAssetTest(id: ID!): Boolean!
            }
            type Vendor {
                id: ID
                featuredProduct: Product
            }
        `,
        resolvers: [TestResolver1636],
    },
    adminApiExtensions: {
        schema: gql`
            type Vendor {
                id: ID
                featuredProduct: Product
            }
            type Profile implements Node {
                id: ID!
                createdAt: DateTime!
                updatedAt: DateTime!
                name: String!
                user: User!
            }
        `,
        resolvers: [],
    },
    configuration: config => {
        config.customFields.Product.push(
            {
                name: 'cfVendor',
                type: 'relation',
                entity: Vendor,
                graphQLType: 'Vendor',
                list: false,
                internal: false,
                public: true,
            },
            {
                name: 'owner',
                nullable: true,
                type: 'relation',
                // Using the Channel entity rather than User as in the example comment at
                // https://github.com/vendurehq/vendure/issues/1664#issuecomment-1293916504
                // because using a User causes a recursive infinite loop in TypeORM between
                // Product > User > Vendor > Product etc.
                entity: Channel,
                public: false,
                eager: true, // needs to be eager to enable indexing of user->profile attributes like name, etc.
                readonly: true,
            },
        );
        config.customFields.User.push({
            name: 'cfVendor',
            type: 'relation',
            entity: Vendor,
            graphQLType: 'Vendor',
            list: false,
            eager: true,
            internal: false,
            public: true,
        });

        config.customFields.Channel.push({
            name: 'profile',
            type: 'relation',
            entity: Profile,
            nullable: true,
            public: false,
            internal: false,
            readonly: true,
            eager: true, // needs to be eager to enable indexing of profile attributes like name, etc.
        });

        config.customFields.Order.push({
            name: 'productOwner',
            nullable: true,
            type: 'relation',
            entity: User,
            public: false,
            eager: true,
            readonly: true,
        });

        return config;
    },
})
// eslint-disable-next-line @typescript-eslint/naming-convention
export class TestPlugin1636_1664 implements OnApplicationBootstrap {
    static testResolverSpy = vi.fn();

    constructor(private connection: TransactionalConnection) {}

    async onApplicationBootstrap() {
        const profilesCount = await this.connection.rawConnection.getRepository(Profile).count();
        if (0 < profilesCount) {
            return;
        }
        // Create a Profile and assign it to all the products
        const channels = await this.connection.rawConnection.getRepository(Channel).find();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const channel = channels[0]!;
        const profile = await this.connection.rawConnection.getRepository(Profile).save(
            new Profile({
                name: 'Test Profile',
            }),
        );

        (channel.customFields as any).profile = profile;
        await this.connection.rawConnection.getRepository(Channel).save(channel);

        const asset = await this.connection.rawConnection.getRepository(Asset).findOne({ where: { id: 1 } });
        if (asset) {
            const profileAsset = this.connection.rawConnection.getRepository(ProfileAsset).save({
                asset,
                profile,
            });
        }

        const products = await this.connection.rawConnection.getRepository(Product).find();
        for (const product of products) {
            (product.customFields as any).owner = channel;
            await this.connection.rawConnection.getRepository(Product).save(product);
        }
    }
}
