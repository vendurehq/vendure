import { Info, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ConfigArg, ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { GraphQLResolveInfo } from 'graphql';

import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { ConfigArgService } from '../../../service/helpers/config-arg/config-arg.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

/**
 * Resolves the `args` of every {@link ConfigurableOperation} returned anywhere in the API. Because
 * all configurable operations — core or custom, on core or custom entities — are represented by the
 * single `ConfigurableOperation` GraphQL type, this one resolver is the single place where `secret`
 * config arg values are gated: a value is either decrypted (when the {@link SecretAccessStrategy}
 * permits) or replaced with a redaction placeholder, so no per-operation-type wiring is required.
 *
 * An arg is treated as secret based on its definition (`secret: true`), so that a value which is not
 * (or not yet) encrypted at rest — e.g. legacy plaintext written before the field was marked secret —
 * is still redacted rather than served in the clear. Conversely, a non-secret arg whose value happens
 * to look like ciphertext is left untouched, so it is not accidentally redacted or run through
 * `decrypt()`. If `secret: true` is later removed from a def, any encrypted values already stored are
 * passed through unchanged until the operation is next saved.
 */
@Resolver('ConfigurableOperation')
export class ConfigurableOperationEntityResolver {
    constructor(private configService: ConfigService, private configArgService: ConfigArgService) {}

    @ResolveField()
    async args(
        @Ctx() ctx: RequestContext,
        @Parent() operation: ConfigurableOperation,
        @Info() info: GraphQLResolveInfo,
    ): Promise<ConfigArg[]> {
        const { encryptionStrategy, secretAccessStrategy } = this.configService.systemOptions;
        const owner = this.deriveOwner(info);
        const output: ConfigArg[] = [];
        for (const arg of operation.args) {
            if (arg.value == null || !this.configArgService.hasSecretArg(operation.code, arg.name)) {
                output.push({ ...arg });
                continue;
            }
            const canReveal = secretAccessStrategy
                ? await secretAccessStrategy.canAccessSecret(ctx, {
                      kind: 'configArg',
                      code: operation.code,
                      entityType: owner.entityType,
                      field: owner.field,
                      argName: arg.name,
                  })
                : false;
            let value: string;
            if (!canReveal) {
                value = REDACTED_SECRET_PLACEHOLDER;
            } else if (encryptionStrategy && encryptionStrategy.isEncrypted(arg.value)) {
                try {
                    value = encryptionStrategy.decrypt(arg.value);
                } catch (e: any) {
                    // A single arg that cannot be decrypted must not fail the whole query.
                    Logger.error(
                        `Failed to decrypt secret arg "${arg.name}" of operation "${operation.code}": ` +
                            (e.message as string),
                    );
                    value = REDACTED_SECRET_PLACEHOLDER;
                }
            } else {
                // A legacy plaintext value is returned as-is.
                value = arg.value;
            }
            output.push({ ...arg, value });
        }
        return output;
    }

    /**
     * Walks up the GraphQL query path from the `args` field to the field that produced this
     * operation, e.g. `PaymentMethod.handler` or `Collection.filters`. List-valued fields insert a
     * numeric index segment (which carries no typename), so those are skipped.
     */
    private deriveOwner(info: GraphQLResolveInfo): { entityType: string | undefined; field: string | undefined } {
        let segment: GraphQLResolveInfo['path'] | undefined = info.path.prev;
        while (segment && typeof segment.key === 'number') {
            segment = segment.prev;
        }
        if (segment && typeof segment.key === 'string') {
            return { entityType: segment.typename, field: segment.key };
        }
        return { entityType: undefined, field: undefined };
    }
}
