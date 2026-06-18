import { CustomCustomerFields } from '@vendure/core/dist/entity/custom-entity-fields';

import { WishlistItem } from './entities/wishlist-item.entity';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
  interface CustomCustomerFields {
    wishlistItems: WishlistItem[];
  }
}
