// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const prepareAssets = require('./prepare-assets.cjs') as (createRoot: string) => void;

try {
    prepareAssets(__dirname);
} catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
}
