import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { VendureEntity } from '../../entity/base/base.entity';

/**
 * @description
 * The details of the secret value being accessed, passed to {@link SecretAccessStrategy}. This is a
 * discriminated union on `kind`: a secret is either a `secret` custom field on an entity, or a
 * `secret` config arg on a configurable operation. Each variant carries only the information that is
 * actually available in that context, so there are no fields that are sometimes populated and
 * sometimes not.
 *
 * @since 3.8.0
 * @docsCategory configuration
 * @docsPage SecretAccessStrategy
 */
export type SecretAccessInput =
    | {
          kind: 'customField';
          /**
           * @description
           * The name of the entity type the custom field belongs to, e.g. `'Product'` or
           * `'PaymentMethod'`.
           */
          entityType: string;
          /**
           * @description
           * The name of the `secret` custom field being accessed.
           */
          fieldName: string;
          /**
           * @description
           * The entity instance carrying the custom field. Available for the common case where the
           * entity's `customFields` are resolved by the built-in entity resolver, but may be
           * `undefined` for types whose `customFields` are resolved by GraphQL's default resolver
           * (e.g. `ShippingMethodQuote`/`PaymentMethodQuote`, or some plugin-defined types).
           */
          entity: VendureEntity | undefined;
      }
    | {
          kind: 'configArg';
          /**
           * @description
           * The code of the configurable operation the arg belongs to, e.g. the payment method
           * handler or collection filter code. Always defined, and together with `argName` uniquely
           * identifies which secret is being accessed.
           */
          code: string;
          /**
           * @description
           * The name of the entity type the operation belongs to, e.g. `'PaymentMethod'` or
           * `'Collection'`. This is derived from the GraphQL query path, so in rare cases (e.g. an
           * operation exposed via an unusual schema shape) it may be `undefined`. The owning entity
           * instance itself is not available in this context.
           */
          entityType: string | undefined;
          /**
           * @description
           * The name of the field on the owning entity that holds the operation, e.g. `'handler'`
           * or `'filters'`. Derived from the GraphQL query path, so it may be `undefined` in the
           * same rare cases as `entityType`.
           */
          field: string | undefined;
          /**
           * @description
           * The name of the `secret` config arg being accessed.
           */
          argName: string;
      };

/**
 * @description
 * The SecretAccessStrategy determines whether the current user is allowed to see the decrypted value
 * of a `secret` custom field or config arg. By default, writing a secret is governed by the entity's
 * normal `Create`/`Update` permission and only reading is gated, but a custom strategy may apply
 * finer-grained logic based on the entity, field or operation.
 *
 * :::info
 *
 * This is configured via the `systemOptions.secretAccessStrategy` property of your VendureConfig.
 *
 * :::
 *
 * @since 3.8.0
 * @docsCategory configuration
 * @docsPage SecretAccessStrategy
 * @docsWeight 0
 */
export interface SecretAccessStrategy extends InjectableStrategy {
    /**
     * @description
     * Returns `true` if the operation is permitted. When it returns `false` for a `read`, the API
     * returns a redaction placeholder instead of the decrypted value.
     */
    canAccessSecret(ctx: RequestContext, input: SecretAccessInput): boolean | Promise<boolean>;
}
