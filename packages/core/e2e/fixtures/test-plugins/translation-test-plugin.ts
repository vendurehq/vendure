import { OnApplicationBootstrap } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    ErrorResult,
    I18nService,
    PluginCommonModule,
    RequestContext,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';
import path from 'path';

class CustomError extends ErrorResult {
    readonly __typename = 'CustomError';
    readonly errorCode = 'CUSTOM_ERROR';
    readonly message = 'CUSTOM_ERROR';
}

class NewError extends ErrorResult {
    readonly __typename = 'NewError';
    readonly errorCode = 'NEW_ERROR';
    readonly message = 'NEW_ERROR';
}

@Resolver()
class TestResolver {
    @Query()
    async customErrorMessage(@Ctx() ctx: RequestContext, @Args() args: any) {
        return new CustomError();
    }

    @Query()
    async newErrorMessage(@Ctx() ctx: RequestContext, @Args() args: any) {
        return new NewError();
    }
}

export const CUSTOM_ERROR_MESSAGE_TRANSLATION = 'A custom error message';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [I18nService],
    adminApiExtensions: {
        schema: gql`
            extend type Query {
                customErrorMessage: CustomResult
                newErrorMessage: CustomResult
            }

            type CustomError implements ErrorResult {
                errorCode: ErrorCode!
                message: String!
            }

            type NewError implements ErrorResult {
                errorCode: ErrorCode!
                message: String!
            }

            "Return anything and the error that should be thrown"
            union CustomResult = Product | CustomError | NewError
        `,
        resolvers: [TestResolver],
    },
})
export class TranslationTestPlugin implements OnApplicationBootstrap {
    constructor(private i18nService: I18nService) {}

    onApplicationBootstrap(): any {
        this.i18nService.addTranslation('en', {
            errorResult: {
                CUSTOM_ERROR: CUSTOM_ERROR_MESSAGE_TRANSLATION,
            },
        });

        this.i18nService.addTranslation('de', {
            errorResult: {
                CUSTOM_ERROR: 'DE_' + CUSTOM_ERROR_MESSAGE_TRANSLATION,
            },
        });

        this.i18nService.addTranslationFile('en', path.join(__dirname, '../i18n/en.json'));
        this.i18nService.addTranslationFile('de', path.join(__dirname, '../i18n/de.json'));
    }
}
