import { Injectable } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

@Injectable()
export class NameService {
    getNames(): string[] {
        return ['seon', 'linda', 'hong'];
    }
}

@Resolver()
export class TestResolverWithInjection {
    constructor(private nameService: NameService) {}

    @Query()
    names() {
        return this.nameService.getNames();
    }
}

@VendurePlugin({
    providers: [NameService],
    shopApiExtensions: {
        resolvers: [TestResolverWithInjection],
        schema: gql`
            extend type Query {
                names: [String]!
            }
        `,
    },
})
export class TestPluginWithProvider {}
