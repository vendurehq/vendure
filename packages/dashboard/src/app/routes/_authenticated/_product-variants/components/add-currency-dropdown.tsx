import { useLingui } from '@lingui/react/macro';
import { PlusIcon } from 'lucide-react';

import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';

interface AddCurrencyDropdownProps {
    unusedCurrencies: string[];
    onCurrencySelect: (currencyCode: string) => void;
    placeholder?: string;
}

export function AddCurrencyDropdown({
    unusedCurrencies,
    onCurrencySelect,
    placeholder,
}: AddCurrencyDropdownProps) {
    const { formatCurrencyName } = useLocalFormat();
    const { t } = useLingui();

    if (unusedCurrencies.length === 0) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="gap-2" />}>
                <PlusIcon className="size-4" />
                {placeholder || t`Add a price in another currency`}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {unusedCurrencies.map(currencyCode => (
                    <DropdownMenuItem key={currencyCode} onClick={() => onCurrencySelect(currencyCode)}>
                        <span className="uppercase text-muted-foreground">{currencyCode}</span>
                        {formatCurrencyName(currencyCode)}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
