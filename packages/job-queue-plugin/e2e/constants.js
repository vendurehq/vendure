const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;

module.exports = {
    redisHost,
    redisPort,
};
