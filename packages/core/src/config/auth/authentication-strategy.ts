import { DocumentNode } from 'graphql';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { User } from '../../entity/user/user.entity';

/**
 * @description
 * An AuthenticationStrategy defines how a User (which can be a Customer in the Shop API or
 * and Administrator in the Admin API) may be authenticated.
 *
 * Real-world examples can be found in the [Authentication guide](/core-concepts/auth/).
 *
 * :::info
 *
 * This is configured via the `authOptions.shopAuthenticationStrategy` and `authOptions.adminAuthenticationStrategy`
 * properties of your VendureConfig.
 *
 * :::
 *
 * @docsCategory auth
 */
export interface AuthenticationStrategy<Data = unknown> extends InjectableStrategy {
    /**
     * @description
     * The name of the strategy, for example `'facebook'`, `'google'`, `'keycloak'`.
     */
    readonly name: string;

    /**
     * @description
     * Defines the type of the GraphQL Input object expected by the `authenticate`
     * mutation. The final input object will be a map, with the key being the name
     * of the strategy. The shape of the input object should match the generic `Data`
     * type argument.
     *
     * @example
     * For example, given the following:
     *
     * ```ts
     * defineInputType() {
     *   return gql`
     *      input MyAuthInput {
     *        token: String!
     *      }
     *   `;
     * }
     * ```
     *
     * assuming the strategy name is "my_auth", then the resulting call to `authenticate`
     * would look like:
     *
     * ```GraphQL
     * authenticate(input: {
     *   my_auth: {
     *     token: "foo"
     *   }
     * }) {
     *   # ...
     * }
     * ```
     *
     * **Note:** if more than one graphql `input` type is being defined (as in a nested input type), then
     * the _first_ input will be assumed to be the top-level input.
     */
    defineInputType(): DocumentNode;

    /**
     * @description
     * Used to authenticate a user with the authentication provider. This method
     * will implement the provider-specific authentication logic, and should resolve to either a
     * {@link User} object on success, or `false | string` on failure.
     * A `string` return could be used to describe what error happened, otherwise `false` to an unknown error.
     */
    authenticate(ctx: RequestContext, data: Data): Promise<User | false | string>;

    /**
     * @description
     * Called when a user logs out, and may perform any required tasks
     * related to the user logging out with the external provider.
     */
    onLogOut?(ctx: RequestContext, user: User): Promise<void>;
}
