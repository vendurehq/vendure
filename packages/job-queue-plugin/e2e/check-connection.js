const { RedisConnection } = require('bullmq');
const { redisHost, redisPort } = require('./constants');

const connection = new RedisConnection({
    port: redisPort,
    host: redisHost,
});

let timer;

/**
 * When contributing to Vendure, developers who made changes unrelated to
 * this plugin should not be expected to set up an Redis instance
 * locally just so they can get the pre-push hook to pass. So if no
 * instance is available, we skip the tests.
 */
function checkConnection() {
    return new Promise(async (resolve, reject) => {
        try {
            timer = setTimeout(() => {
                logConnectionFailure();
                process.exit(0);
            }, 5000);
            connection.on('error', err => {
                resolve(0);
            });
            const client = await connection.client;

            clearTimeout(timer);

            await client.ping((err, result) => {
                if (err) {
                    resolve(0);
                } else {
                    // If the connection is available, we exit with 1 in order to invoke the
                    // actual e2e test script (since we are using the `||` operator in the "e2e" script)
                    resolve(1);
                }
            });
        } catch (e) {
            logConnectionFailure();
            // If no redis available, we exit with 0 so that the npm script
            // exits
            resolve(0);
        }
    });
}

checkConnection().then(result => {
    process.exit(result);
});

function logConnectionFailure() {
    console.log(`Could not connect to Redis instance at "${redisHost}:${redisPort}"`);
    console.log(`Skipping e2e tests for BullMQJobQueuePlugin`);
    process.env.SKIP_ELASTICSEARCH_E2E_TESTS = true;
}
