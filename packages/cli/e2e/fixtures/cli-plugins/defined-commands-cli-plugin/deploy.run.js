import { incomplete } from '@vendure/common/lib/command';

// A risk that only the run finds: a deployment to production needs the caller's consent, with the
// digest of what it will deploy.
export async function run(input, ctx) {
    if (input.environment === 'production') {
        const answer = await ctx.consent('deployToProduction', { environment: input.environment });
        if (answer !== true) {
            return incomplete([answer]);
        }
    }
    return { deployed: input.environment };
}
