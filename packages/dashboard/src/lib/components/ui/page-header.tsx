export {
    PageHeader,
    PageHeaderActions,
    PageHeaderBack,
    PageHeaderBackRow,
    PageHeaderContent,
    PageHeaderDescription,
    PageHeaderTitle,
} from '@vendure-io/ui/components/molecules/page-header';

import { PageHeaderBackRow } from '@vendure-io/ui/components/molecules/page-header';

/**
 * @deprecated Use `PageHeaderBackRow`. Kept so existing extensions compile.
 */
export const PageHeaderBackLink = PageHeaderBackRow;
