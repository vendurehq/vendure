process.env.NODE_ENV = 'production';

// 加载 .env 环境变量：pm2 exec cwd 是本目录（packages/dev-server），默认 config() 读不到根 .env，
// 补显式根路径二次加载（dotenv 默认不覆盖已定义值，两行均安全）
require('dotenv').config();
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// 确保 PostgreSQL 连接配置
if (!process.env.DB) {
    process.env.DB = 'postgres';
}
if (!process.env.DB_HOST) {
    process.env.DB_HOST = '127.0.0.1';
}

// 禁用开发调试工具（生产环境不需要）
process.env.IS_PROD = 'true';
process.env.DEV_BYPASS_SMS = 'false';
process.env.DEV_BYPASS_WECHAT = 'false';
process.env.DEV_BYPASS_WECHATPAY = 'false';
process.env.DEV_BYPASS_ALIPAY = 'false';
process.env.DEV_BYPASS_DOUYIN = 'false';
process.env.SSO_MOCK = 'false';

// 启动 Vendure Server（已编译为 JS，不依赖 ts-node）
require('./dist/index');
