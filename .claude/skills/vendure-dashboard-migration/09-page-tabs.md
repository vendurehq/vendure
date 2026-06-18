## Page Tabs

### Old (Angular)
```ts
import { registerPageTab } from '@vendure/admin-ui/core';

import { ReviewListComponent } from './components/review-list/review-list.component';

export default [
    registerPageTab({
        location: 'product-detail',
        tab: 'Reviews',
        route: 'reviews',
        tabIcon: 'star',
        component: ReviewListComponent,
    }),
];
```

### New (React Dashboard)

Page tabs are not supported by the Dashboard. Suggest alternative such as a new route.
