import {
    addNavMenuItem,
    registerDashboardWidget,
    registerFormInputComponent,
    registerPageTab,
    setDashboardWidgetLayout,
} from '@vendure/admin-ui/core';

import { RelationReviewInputComponent } from './components/featured-review-selector/featured-review-selector.component';
import { ProductReviewsListComponent } from './components/product-reviews-list/product-reviews-list.component';
import { ReviewCountLinkComponent } from './components/review-count-link/review-count-link.component';
import { StarRatingComponent } from './components/star-rating/star-rating.component';

export default [
    registerFormInputComponent('review-count-link', ReviewCountLinkComponent),
    registerFormInputComponent('star-rating-form-input', StarRatingComponent),
    registerFormInputComponent('review-selector-form-input', RelationReviewInputComponent),
    addNavMenuItem(
        {
            id: 'reviews',
            label: 'Product reviews',
            routerLink: ['/extensions/product-reviews'],
            icon: 'star',
        },
        'marketing',
    ),
    registerDashboardWidget('reviews', {
        title: 'Latest reviews',
        supportedWidths: [4, 6, 8, 12],
        loadComponent: () => import('./widgets/reviews-widget/reviews-widget.component').then(m => m.default),
    }),
    setDashboardWidgetLayout([
        { id: 'metrics', width: 12 },
        { id: 'orderSummary', width: 6 },
        { id: 'reviews', width: 6 },
        { id: 'latestOrders', width: 12 },
    ]),
    registerPageTab({
        location: 'product-detail',
        route: 'reviews',
        tab: 'Reviews',
        tabIcon: 'star',
        component: ProductReviewsListComponent,
    }),
];
