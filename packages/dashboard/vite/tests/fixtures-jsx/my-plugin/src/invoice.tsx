/**
 * Simulates server-side React usage in a plugin, e.g. rendering PDF invoices
 * or email templates. Imported by the plugin, so it ends up in the config
 * import graph that the dashboard compiler walks.
 */
export const Invoice = () => <div>Invoice</div>;
