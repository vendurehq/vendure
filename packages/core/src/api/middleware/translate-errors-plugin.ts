import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';

import { I18nService } from '../../i18n/i18n.service';

/**
 * This plugin intercepts outgoing responses and translates any error messages into the
 * current request language.
 *
 * Only the message of each formatted error is replaced, so the fields that the `formatError`
 * function adds to the extensions are kept.
 */
export class TranslateErrorsPlugin implements ApolloServerPlugin {
    constructor(private i18nService: I18nService) {}

    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        return {
            willSendResponse: async requestContext => {
                const { errors, contextValue } = requestContext;
                const { body } = requestContext.response;
                if (errors && body.kind === 'single') {
                    // Apollo Server formats each error in `errors`, in order, so the two lists line up.
                    const formattedErrors =
                        body.singleResult.errors?.length === errors.length
                            ? body.singleResult.errors
                            : undefined;
                    body.singleResult.errors = errors.map((err, i) => {
                        const translated = this.i18nService.translateError(contextValue.req, err);
                        const formatted = formattedErrors?.[i];
                        return formatted
                            ? { ...formatted, message: translated.message }
                            : (translated as any);
                    });
                }
            },
        };
    }
}
