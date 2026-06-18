import { Args, Query, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    ID,
    PluginCommonModule,
    Product,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

@Resolver()
class EntityAccessControlTestResolver {
    constructor(private connection: TransactionalConnection) {}

    /**
     * Uses getRepository(ctx, Product).find() directly — exercises the Proxy path.
     */
    @Query()
    async rawRepositoryProductIds(@Ctx() ctx: RequestContext): Promise<string[]> {
        const products = await this.connection.getRepository(ctx, Product).find({
            order: { id: 'ASC' },
        });
        return products.map(p => p.id.toString());
    }

    /**
     * Uses getRepository(ctx, Product).findOne() directly — exercises the Proxy path.
     */
    @Query()
    async rawRepositoryProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
    ): Promise<{ id: string } | null> {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: args.id },
        });
        return product ? { id: product.id.toString() } : null;
    }

    /**
     * Uses getRepository(ctx, Product).findAndCount() — exercises the Proxy path.
     */
    @Query()
    async rawRepositoryProductFindAndCount(@Ctx() ctx: RequestContext): Promise<number> {
        const [items, count] = await this.connection.getRepository(ctx, Product).findAndCount({
            order: { id: 'ASC' },
        });
        return count;
    }

    /**
     * Uses getRepository(ctx, Product).count() — exercises the Proxy path.
     */
    @Query()
    async rawRepositoryProductCount(@Ctx() ctx: RequestContext): Promise<number> {
        return this.connection.getRepository(ctx, Product).count();
    }

    /**
     * Uses getRepository(ctx, Product).createQueryBuilder().getMany() — exercises
     * the QueryBuilder Proxy path. This is the pattern a plugin author would use
     * when building custom queries.
     */
    @Query()
    async qbProductIds(@Ctx() ctx: RequestContext): Promise<string[]> {
        const products = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .orderBy('product.id', 'ASC')
            .getMany();
        return products.map(p => p.id.toString());
    }

    /**
     * Uses createQueryBuilder().getOne() — exercises the single-entity QB Proxy path.
     */
    @Query()
    async qbProduct(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<{ id: string } | null> {
        const product = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .where('product.id = :id', { id: args.id })
            .getOne();
        return product ? { id: product.id.toString() } : null;
    }

    /**
     * Uses createQueryBuilder().getCount() — exercises the count QB Proxy path.
     */
    @Query()
    async qbProductCount(@Ctx() ctx: RequestContext): Promise<number> {
        return this.connection.getRepository(ctx, Product).createQueryBuilder('product').getCount();
    }

    /**
     * Uses createQueryBuilder().getOneOrFail() — exercises the QB Proxy path.
     * Returns the product ID or throws EntityNotFoundError.
     */
    @Query()
    async qbProductOneOrFail(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<{ id: string }> {
        const product = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .where('product.id = :id', { id: args.id })
            .getOneOrFail();
        return { id: product.id.toString() };
    }

    /**
     * Uses createQueryBuilder().getManyAndCount() — exercises the QB Proxy path.
     */
    @Query()
    async qbProductManyAndCount(@Ctx() ctx: RequestContext): Promise<number> {
        const [items, count] = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .orderBy('product.id', 'ASC')
            .getManyAndCount();
        return count;
    }

    /**
     * Uses createQueryBuilder().getExists() — exercises the QB Proxy path.
     */
    @Query()
    async qbProductExists(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<boolean> {
        return this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .where('product.id = :id', { id: args.id })
            .getExists();
    }

    /**
     * Uses createQueryBuilder().getRawMany() — exercises the QB Proxy path.
     * Returns raw row IDs as strings.
     */
    @Query()
    async qbProductRawMany(@Ctx() ctx: RequestContext): Promise<string[]> {
        const rows: Array<{ product_id: number }> = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .select('product.id')
            .orderBy('product.id', 'ASC')
            .getRawMany();
        return rows.map(r => String(r.product_id));
    }

    /**
     * Uses createQueryBuilder().getRawOne() — exercises the QB Proxy path.
     */
    @Query()
    async qbProductRawOne(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
    ): Promise<{ id: string } | null> {
        const row: { product_id: number } | undefined = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .select('product.id')
            .where('product.id = :id', { id: args.id })
            .getRawOne();
        return row ? { id: String(row.product_id) } : null;
    }

    /**
     * Uses createQueryBuilder().getRawAndEntities() — exercises the QB Proxy path.
     * Returns entity IDs as strings.
     */
    @Query()
    async qbProductRawAndEntities(@Ctx() ctx: RequestContext): Promise<string[]> {
        const { entities } = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .orderBy('product.id', 'ASC')
            .getRawAndEntities();
        return entities.map(p => p.id.toString());
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Query {
                rawRepositoryProductIds: [String!]!
                rawRepositoryProduct(id: ID!): JSON
                rawRepositoryProductFindAndCount: Int!
                rawRepositoryProductCount: Int!
                qbProductIds: [String!]!
                qbProduct(id: ID!): JSON
                qbProductCount: Int!
                qbProductOneOrFail(id: ID!): JSON!
                qbProductManyAndCount: Int!
                qbProductExists(id: ID!): Boolean!
                qbProductRawMany: [String!]!
                qbProductRawOne(id: ID!): JSON
                qbProductRawAndEntities: [String!]!
            }
        `,
        resolvers: [EntityAccessControlTestResolver],
    },
})
export class EntityAccessControlTestPlugin {}
