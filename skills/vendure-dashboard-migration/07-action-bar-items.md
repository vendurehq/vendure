## Action Bar Items

### Old (Angular)
```ts
import { addActionBarItem } from '@vendure/admin-ui/core';

export default [
    addActionBarItem({
        id: 'print-invoice',
        locationId: 'order-detail',
        label: 'Print invoice',
        icon: 'printer',
        routerLink: route => {
            const id = route.snapshot.params.id;
            return ['./extensions/order-invoices', id];
        },
        requiresPermission: 'ReadOrder',
    }),
];
```

### New (React Dashboard)

```tsx
import { Button, defineDashboardExtension } from '@vendure/dashboard';
import { useState } from 'react';

defineDashboardExtension({
    actionBarItems: [
        {
            pageId: 'product-detail',
            component: ({ context }) => {
                const [count, setCount] = useState(0);
                return (
                    <Button type="button" variant="secondary" onClick={() => setCount(x => x + 1)}>
                        Counter: {count}
                    </Button>
                );
            },
        },
    ],
});
```
