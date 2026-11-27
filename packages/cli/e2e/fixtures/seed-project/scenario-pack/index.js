// A scenario pack for seed-command.e2e-spec.ts. With SEED_SCENARIO_FAIL set, it writes and then
// fails, so the spec can check the rollback and the retry.
const { ZoneService } = require('@vendure/core');

exports.scenario = {
    name: 'demo',
    preset: 'uk',
    async seed(ctx, app) {
        await app.get(ZoneService).create(ctx, { name: 'Scenario zone' });
        if (process.env.SEED_SCENARIO_FAIL) {
            throw new Error('The demo scenario failed');
        }
    },
};
