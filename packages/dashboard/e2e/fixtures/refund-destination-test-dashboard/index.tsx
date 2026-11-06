import { defineDashboardExtension } from '@vendure/dashboard';
import { Wallet } from 'lucide-react';

// #4563 — registers the dashboard-side presentation of the `store-credit` refund destination
// defined by `e2eRefundDestinations` in e2e-shared-config.ts. Exercises all three optional parts
// of the extension: the label override, the icon, and the configuration component whose value is
// sent to the backend strategy as the refund target's `arguments`.
defineDashboardExtension({
    refundDestinations: [
        {
            code: 'store-credit',
            label: 'Store credit (plugin label)',
            icon: Wallet,
            component: ({ value, onChange }) => (
                <label className="flex items-center gap-2 text-sm">
                    Expires in days:
                    <input
                        data-testid="store-credit-expiry-input"
                        type="number"
                        className="border rounded px-2 py-1 w-24"
                        value={value?.expiresInDays ?? ''}
                        onChange={e =>
                            onChange(
                                e.target.value === ''
                                    ? undefined
                                    : { expiresInDays: Number(e.target.value) },
                            )
                        }
                    />
                </label>
            ),
        },
    ],
});
