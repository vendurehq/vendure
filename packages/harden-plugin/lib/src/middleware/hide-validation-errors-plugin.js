"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HideValidationErrorsPlugin = void 0;
const index_1 = require("graphql/error/index");
/**
 * @description
 * Hides graphql-js suggestions when invalid field names are given.
 * Based on ideas discussed in https://github.com/apollographql/apollo-server/issues/3919
 */
class HideValidationErrorsPlugin {
    async requestDidStart() {
        return {
            willSendResponse: async (requestContext) => {
                const { errors } = requestContext;
                if (errors) {
                    requestContext.response.errors = errors.map(err => {
                        if (err.message.includes('Did you mean')) {
                            return new index_1.GraphQLError('Invalid request');
                        }
                        else {
                            return err;
                        }
                    });
                }
            },
        };
    }
}
exports.HideValidationErrorsPlugin = HideValidationErrorsPlugin;
//# sourceMappingURL=hide-validation-errors-plugin.js.map