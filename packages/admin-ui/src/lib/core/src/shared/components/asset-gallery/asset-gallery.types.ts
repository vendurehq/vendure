import { ItemOf } from '../../../common/base-list.component';
import { GetAssetListQuery } from '../../../common/generated-types';

export type AssetLike = ItemOf<GetAssetListQuery, 'assets'>;
