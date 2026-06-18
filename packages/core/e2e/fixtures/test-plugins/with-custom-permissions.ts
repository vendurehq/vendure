import { Mutation, Query, Resolver } from '@nestjs/graphql';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Allow, CrudPermissionDefinition, PermissionDefinition, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

export const sync = new PermissionDefinition({
    name: 'SyncWishlists',
    description: 'Allows syncing wishlists via Admin API',
});
export const wishlist = new CrudPermissionDefinition('Wishlist');

@Resolver()
export class TestWishlistResolver {
    @Allow(wishlist.Read)
    @Query()
    wishlist() {
        return true;
    }
    @Allow(wishlist.Create)
    @Mutation()
    createWishlist() {
        return true;
    }
    @Allow(wishlist.Update)
    @Mutation()
    updateWishlist() {
        return true;
    }
    @Allow(wishlist.Delete)
    @Mutation()
    deleteWishlist() {
        return true;
    }
    @Allow(sync.Permission)
    @Mutation()
    syncWishlist() {
        return true;
    }
}

@VendurePlugin({
    imports: [],
    adminApiExtensions: {
        resolvers: [TestWishlistResolver],
        schema: gql`
            extend type Query {
                wishlist: Boolean!
            }
            extend type Mutation {
                createWishlist: Boolean!
                updateWishlist: Boolean!
                deleteWishlist: Boolean!
                syncWishlist: Boolean!
            }
        `,
    },
    configuration: config => {
        config.authOptions.customPermissions = [sync, wishlist];
        return config;
    },
})
export class TestPluginWithCustomPermissions {}
