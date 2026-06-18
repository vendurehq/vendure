export const REQUIRED_NODE_VERSION = '>=20.0.0';
export const SERVER_PORT = 3000;
export const STOREFRONT_PORT = 3001;
export const STOREFRONT_REPO = 'vendure-ecommerce/nextjs-starter-vendure';
export const STOREFRONT_BRANCH = 'main';
/**
 * The TypeScript version needs to pinned because minor versions often
 * introduce breaking changes.
 */
export const TYPESCRIPT_VERSION = '5.8.2';
/**
 * Vite must be a direct dependency of the scaffolded project because the
 * generated vite.config.mts imports `vite` directly, and strict
 * (non-hoisting) package managers like pnpm don't expose transitive deps.
 * The range tracks @vendure/dashboard's declaration so the scaffold stays
 * on the same Vite major line as the dashboard (currently v7); the caret
 * caps at <8.0.0, which is important because Vite 8 ships a Rolldown-based
 * bundler with breaking changes.
 */
export const VITE_VERSION = '^7.3.1';

// Port scanning
export const PORT_SCAN_RANGE = 20;

// Timing constants (milliseconds)
export const SCAFFOLD_DELAY_MS = 500;
export const TIP_INTERVAL_MS = 10_000;
export const CI_PAUSE_BEFORE_CLOSE_MS = 30_000;
export const CI_PAUSE_AFTER_CLOSE_MS = 10_000;
export const NORMAL_PAUSE_BEFORE_CLOSE_MS = 2_000;
export const AUTO_RUN_DELAY_MS = 10_000;

// Default project values
export const DEFAULT_PROJECT_VERSION = '0.1.0';
export const TIPS_WHILE_WAITING = [
    '☕ This can take a minute or two, so grab a coffee',
    `✨ We'd love it if you drop us a star on GitHub: https://github.com/vendurehq/vendure`,
    `📖 Check out the Vendure documentation at https://docs.vendure.io`,
    `💬 Join our Discord community to chat with other Vendure developers: https://vendure.io/community`,
    '💡 In the mean time, here are some tips to get you started',
    `Vendure provides dedicated GraphQL APIs for both the Admin and Shop`,
    `Almost every aspect of Vendure is customizable via plugins`,
    `You can run 'vendure add' from the command line to add new plugins & features`,
    `Use the EventBus in your plugins to react to events in the system`,
    `Vendure supports multiple languages & currencies out of the box`,
    `☕ Did we mention this can take a while?`,
    `Our custom fields feature allows you to add any kind of data to your entities`,
    `Vendure is built with TypeScript, so you get full type safety`,
    `Combined with GraphQL's static schema, your type safety is end-to-end`,
    `☕ Almost there now... thanks for your patience!`,
    `Collections allow you to group products together`,
    `Our AssetServerPlugin allows you to dynamically resize & optimize images`,
    `Order flows are fully customizable to suit your business requirements`,
    `Role-based permissions allow you to control access to every part of the system`,
    `Customers can be grouped for targeted promotions & custom pricing`,
    `You can find integrations in the Vendure Hub: https://vendure.io/hub`,
];
