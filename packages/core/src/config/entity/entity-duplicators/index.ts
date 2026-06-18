import { collectionDuplicator } from './collection-duplicator';
import { facetDuplicator } from './facet-duplicator';
import { productDuplicator } from './product-duplicator';
import { promotionDuplicator } from './promotion-duplicator';

export const defaultEntityDuplicators = [
    productDuplicator,
    collectionDuplicator,
    facetDuplicator,
    promotionDuplicator,
];
