import { MultiSelect as UiMultiSelect } from '@vendure-io/ui/components/molecules/multi-select';
import {
    Combobox,
    ComboboxChip,
    ComboboxChips,
    ComboboxChipsInput,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from '../ui/combobox.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

interface MultiSelectItem {
    value: string;
    label: string;
    /**
     * The display value to use for the item.
     * If not provided, the label will be used.
     * This is useful for displaying a more complex value in
     * a React component.
     */
    display?: string | React.ReactNode;
}

export interface MultiSelectProps<T extends boolean> {
    value: T extends true ? string[] : string;
    onChange: (value: T extends true ? string[] : string) => void;
    multiple?: T;
    items: MultiSelectItem[];
    placeholder?: string;
    searchPlaceholder?: string;
    showSearch?: boolean;
    className?: string;
}

export function MultiSelect<T extends boolean>(props: MultiSelectProps<T>) {
    const {
        value,
        onChange,
        multiple,
        items,
        placeholder = 'Select items',
        searchPlaceholder = 'Search...',
        showSearch,
        className,
    } = props;

    // Same rule as the v1 component: show a filtering input for explicit opt-in or long lists.
    const withSearch = showSearch === true || items.length > 10;

    if (withSearch) {
        const byValue = new Map(items.map(item => [item.value, item] as const));

        if (multiple) {
            const selectedItems = (value as string[]).map(v => byValue.get(v) ?? { value: v, label: v });
            return (
                <Combobox
                    items={items}
                    multiple
                    value={selectedItems}
                    onValueChange={(next: MultiSelectItem[]) =>
                        onChange(next.map(item => item.value) as T extends true ? string[] : string)
                    }
                    itemToStringLabel={(item: MultiSelectItem) => item.label}
                    isItemEqualToValue={(a: MultiSelectItem, b: MultiSelectItem) => a.value === b.value}
                >
                    <ComboboxChips className={className}>
                        {selectedItems.map(item => (
                            <ComboboxChip key={item.value} aria-label={item.label}>
                                {item.display ?? item.label}
                            </ComboboxChip>
                        ))}
                        <ComboboxChipsInput
                            placeholder={selectedItems.length === 0 ? placeholder : searchPlaceholder}
                        />
                    </ComboboxChips>
                    <ComboboxContent>
                        <ComboboxEmpty>{searchPlaceholder}</ComboboxEmpty>
                        <ComboboxList>
                            {(item: MultiSelectItem) => (
                                <ComboboxItem key={item.value} value={item}>
                                    {item.display ?? item.label}
                                </ComboboxItem>
                            )}
                        </ComboboxList>
                    </ComboboxContent>
                </Combobox>
            );
        }

        const selectedItem =
            byValue.get(value as string) ?? (value ? { value: value as string, label: value as string } : null);
        return (
            <Combobox
                items={items}
                value={selectedItem}
                onValueChange={(next: MultiSelectItem | null) =>
                    onChange((next?.value ?? '') as T extends true ? string[] : string)
                }
                itemToStringLabel={(item: MultiSelectItem) => item.label}
                isItemEqualToValue={(a: MultiSelectItem, b: MultiSelectItem) => a.value === b.value}
            >
                <ComboboxInput placeholder={placeholder} className={className} />
                <ComboboxContent>
                    <ComboboxEmpty>{searchPlaceholder}</ComboboxEmpty>
                    <ComboboxList>
                        {(item: MultiSelectItem) => (
                            <ComboboxItem key={item.value} value={item}>
                                {item.display ?? item.label}
                            </ComboboxItem>
                        )}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>
        );
    }

    if (multiple) {
        return (
            <UiMultiSelect
                items={items}
                value={value as string[]}
                onValueChange={next => onChange(next as T extends true ? string[] : string)}
                itemToValue={item => item.value}
                itemToLabel={item => item.display ?? item.label}
                placeholder={placeholder}
                className={className}
            />
        );
    }

    const selectItems = Object.fromEntries(items.map(item => [item.value, item.label]));
    return (
        <Select
            value={value as string}
            onValueChange={selected => onChange(selected as T extends true ? string[] : string)}
            items={selectItems}
        >
            <SelectTrigger className={className}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {items.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                        {item.display ?? item.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
