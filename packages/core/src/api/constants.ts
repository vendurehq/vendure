import path from 'path';

export const VENDURE_SHOP_API_TYPE_PATHS = ['shop-api', 'common'].map(p =>
    path.join(__dirname, 'schema', p, '*.graphql'),
);

export const VENDURE_ADMIN_API_TYPE_PATHS = ['admin-api', 'common'].map(p =>
    path.join(__dirname, 'schema', p, '*.graphql'),
);
