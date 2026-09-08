import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans } from '@lingui/react/macro';
import { Order } from '../utils/order-types.js';

export function OrderTaxSummary({ order }: Readonly<{ order: Order }>) {
    const { formatCurrency } = useLocalFormat();
    return (
        <div className="divide-y divide-muted">
            {order.taxSummary.map(taxLine => (
                <div key={taxLine.description} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-baseline gap-3">
                        <div className="min-w-0 flex-1 break-words text-sm font-medium">
                            {taxLine.description}
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {taxLine.taxRate}%
                        </div>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                            <dt className="text-xs text-muted-foreground">
                                <Trans>Tax base</Trans>
                            </dt>
                            <dd className="text-sm tabular-nums">
                                {formatCurrency(taxLine.taxBase, order.currencyCode)}
                            </dd>
                        </div>
                        <div className="text-right">
                            <dt className="text-xs text-muted-foreground">
                                <Trans>Tax total</Trans>
                            </dt>
                            <dd className="text-sm font-medium tabular-nums">
                                {formatCurrency(taxLine.taxTotal, order.currencyCode)}
                            </dd>
                        </div>
                    </dl>
                </div>
            ))}
        </div>
    );
}
