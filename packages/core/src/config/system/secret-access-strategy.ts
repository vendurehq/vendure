import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { VendureEntity } from '../../entity/base/base.entity';

/**
 * @description
 * The details of the secret value being accessed, passed to {@link SecretAccessStrategy}.
 *
 * @since 3.5.0
 * @docsCategory configuration
 * @docsPage SecretAccessStrategy
 */
export interface SecretAccessInput {
    /**
     * @description
     * The operation being attempted. `read` covers returning the decrypted value via the API;
     * `create`/`update` cover writing a new value.
     */
    operation: 'read' | 'create' | 'update';
    /**
     * @description
     * The name of the entity type the secret belongs to, e.g. `'PaymentMethod'` or `'Product'`.
     */
    entityType: string;
    /**
     * @description
     * The target entity, when available (e.g. on a `read` or `update` of an existing entity).
     */
    entity?: VendureEntity;
    /**
     * @description
     * The name of the `secret` custom field or config arg being accessed.
     */
    fieldName: string;
}

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
 * @since 3.5.0
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
