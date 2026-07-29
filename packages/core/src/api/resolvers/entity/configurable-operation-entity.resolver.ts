import { Info, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ConfigArg, ConfigurableOperation } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { GraphQLResolveInfo } from 'graphql';

import { ConfigService } from '../../../config/config.service';
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
 * An arg is treated as secret if its definition declares `secret: true`, so that a value which is
 * not (or not yet) encrypted at rest — e.g. legacy plaintext written before the field was marked
 * secret — is still redacted rather than served in the clear.
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
            const isEncrypted = arg.value != null && encryptionStrategy?.isEncrypted(arg.value) === true;
            const isSecret = isEncrypted || this.configArgService.hasSecretArg(operation.code, arg.name);
            if (arg.value == null || !isSecret) {
                output.push({ ...arg });
                continue;
            }
            const canReveal = secretAccessStrategy
                ? await secretAccessStrategy.canAccessSecret(ctx, {
                      kind: 'configArg',
                      entityType: owner.entityType,
                      field: owner.field,
                      argName: arg.name,
                  })
                : false;
            let value: string;
            if (!canReveal) {
                value = REDACTED_SECRET_PLACEHOLDER;
            } else {
                // When revealing, decrypt if encrypted; a legacy plaintext value is returned as-is.
                value = isEncrypted ? encryptionStrategy!.decrypt(arg.value) : arg.value;
            }
            output.push({ name: arg.name, value });
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
