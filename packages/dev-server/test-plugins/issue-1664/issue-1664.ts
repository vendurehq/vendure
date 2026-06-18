import { OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Asset,
    Channel,
    Order,
    OrderService,
    PluginCommonModule,
    Product,
    RequestContext,
    TransactionalConnection,
    User,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

import { ProfileAsset } from './profile-asset.entity';
import { Profile } from './profile.entity';

declare module '@vendure/core' {
    interface CustomOrderFields {
        productOwner: User;
    }
    interface CustomProductFields {
        owner: User;
    }
}

const schema = gql`
    type Profile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        user: User!
    }
`;

/**
 * Test plugin for https://github.com/vendurehq/vendure/issues/1664
 *
 * Test query:
 * ```graphql
 * query {
 *   product(id: 1) {
 *     name
 *     customFields {
 *       owner {
 *         id
 *         identifier
 *         customFields {
 *           profile {
 *             id
 *             name
 *           }
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: () => [Profile, ProfileAsset],
    shopApiExtensions: { schema, resolvers: [] },
    adminApiExtensions: { schema, resolvers: [] },
    configuration: config => {
        // Order
        config.customFields.Order.push({
            name: 'productOwner', // because orders are always c2c (and should be stored redundant in case product get's deleted)
            nullable: true,
            type: 'relation',
            entity: User,
            public: false,
            eager: true,
            readonly: true,
        });
        config.customFields.Product.push({
            name: 'owner',
            nullable: true,
            type: 'relation',
            entity: User,
            public: false,
            eager: true, // needs to be eager to enable indexing of user->profile attributes like name, etc.
            readonly: true,
        });
        // User
        config.customFields.User.push({
            name: 'profile',
            type: 'relation',
            entity: Profile,
            nullable: true,
            public: false,
            internal: false,
            readonly: true,
            eager: true, // needs to be eager to enable indexing of profile attributes like name, etc.
        });
        return config;
    },
})
export class Test1664Plugin implements OnApplicationBootstrap {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
    ) {}

    async onApplicationBootstrap() {
        await this.createDummyProfiles();
        await this.createDummyOrder();
    }

    async createDummyProfiles() {
        const profilesCount = await this.connection.rawConnection.getRepository(Profile).count();
        if (0 < profilesCount) {
            return;
        }
        // Create a Profile and assign it to all the products
        const users = await this.connection.rawConnection.getRepository(User).find();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const user = users[1]!;
        const profile = await this.connection.rawConnection.getRepository(Profile).save(
            new Profile({
                name: 'Test Profile',
                user,
            }),
        );

        (user.customFields as any).profile = profile;
        await this.connection.rawConnection.getRepository(User).save(user);

        const asset = await this.connection.rawConnection.getRepository(Asset).findOne({ where: { id: 1 } });
        if (asset) {
            const profileAsset = this.connection.rawConnection.getRepository(ProfileAsset).save({
                asset,
                profile,
            });
        }

        const products = await this.connection.rawConnection.getRepository(Product).find();
        for (const product of products) {
            (product.customFields as any).owner = user;
            await this.connection.rawConnection.getRepository(Product).save(product);
        }
    }

    async createDummyOrder() {
        const orderCount = await this.connection.rawConnection.getRepository(Order).count();
        if (0 < orderCount) {
            return;
        }

        const defaultChannel = await this.connection.getRepository(Channel).findOne({
            relations: ['defaultShippingZone', 'defaultTaxZone'],
            where: {
                code: DEFAULT_CHANNEL_CODE,
            },
        });

        if (!defaultChannel) {
            throw new Error(`Channel with code ${DEFAULT_CHANNEL_CODE} could not be found.`);
        }

        const ctx = new RequestContext({
            apiType: 'shop',
            authorizedAsOwnerOnly: false,
            channel: defaultChannel,
            isAuthorized: true,
            languageCode: defaultChannel.defaultLanguageCode,
        });

        // Create order
        const users = await this.connection.rawConnection.getRepository(User).find();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const customer = users[1]!;
        const created = await this.orderService.create(ctx, customer.id);

        // Add products
        const products = await this.connection.rawConnection
            .getRepository(Product)
            .find({ relations: ['variants'] });
        const product = products[0];
        await this.orderService.addItemToOrder(ctx, created.id, product.variants[0].id, 1);
        // Add the product owner to order
        const productOwner = product.customFields.owner;
        await this.orderService.updateCustomFields(ctx, created.id, { productOwner });
    }
}
