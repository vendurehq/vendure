import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';

import { I18nService } from '../../i18n/i18n.service';

/**
 * This plugin intercepts outgoing responses and translates any error messages into the
 * current request language.
 */
export class TranslateErrorsPlugin implements ApolloServerPlugin {
    constructor(private i18nService: I18nService) {}

    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        return {
            willSendResponse: async requestContext => {
                const { errors, contextValue } = requestContext;
                const { body } = requestContext.response;
                if (errors && body.kind === 'single') {
                    body.singleResult.errors = errors.map(err => {
                        return this.i18nService.translateError(contextValue.req, err) as any;
                    });
                }
            },
        };
    }
}
