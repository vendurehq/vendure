import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { cn } from '@/vdb/lib/utils.js';
import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '../ui/input.js';

export interface MultiSelectProps<T extends boolean> {
    value: T extends true ? string[] : string;
    onChange: (value: T extends true ? string[] : string) => void;
    multiple?: T;
    items: Array<{
        value: string;
        label: string;
        /**
         * The display value to use for the item.
         * If not provided, the label will be used.
         * This is useful for displaying a more complex value in
         * a React component.
         */
        display?: string | React.ReactNode;
    }>;
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
    const [search, setSearch] = useState('');

    const filteredItems = items.filter(item => item.label.toLowerCase().includes(search.toLowerCase()));

    const handleSelect = (selectedValue: string) => {
        if (multiple) {
            const currentValue = value as string[];
            const newValue = currentValue.includes(selectedValue)
                ? currentValue.filter(v => v !== selectedValue)
                : [...currentValue, selectedValue];
            onChange(newValue as T extends true ? string[] : string);
        } else {
            onChange(selectedValue as T extends true ? string[] : string);
        }
    };

    const handleRemove = (valueToRemove: string) => {
        if (multiple) {
            const currentValue = value as string[];
            onChange(currentValue.filter(v => v !== valueToRemove) as T extends true ? string[] : string);
        }
    };

    const renderTrigger = () => {
        if (multiple) {
            const selectedValues: string[] = typeof value === 'string' ? [value] : value;
            return (
                <Button
                    variant="outline"
                    role="combobox"
                    className={cn(
                        'w-full justify-between bg-transparent',
                        'min-h-[2.5rem] h-auto',
                        'flex flex-wrap gap-1 p-1',
                        className,
                    )}
                >
                    <div className="flex flex-wrap gap-1">
                        {selectedValues.length > 0 ? (
                            selectedValues.map(selectedValue => {
                                const item = items.find(i => i.value === selectedValue);
                                return (
                                    <Badge
                                        key={selectedValue}
                                        variant="secondary"
                                        className="flex items-center gap-1"
                                    >
                                        {item?.display ?? item?.label ?? selectedValue}
                                        <div
                                            onClick={e => {
                                                e.stopPropagation();
                                                handleRemove(selectedValue);
                                            }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    handleRemove(selectedValue);
                                                }
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            className="ml-1 hover:text-destructive cursor-pointer"
                                            aria-label={`Remove ${item?.label ?? selectedValue}`}
                                        >
                                            <X className="h-3 w-3" />
                                        </div>
                                    </Badge>
                                );
                            })
                        ) : (
                            <span className="text-muted-foreground">{placeholder}</span>
                        )}
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
            );
        }
        const selectedItem = items.find(i => i.value === value);
        return (
            <Button variant="outline" role="combobox" className={cn('w-full justify-between bg-transparent', className)}>
                {selectedItem ? (selectedItem.display ?? selectedItem.label) : placeholder}
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
        );
    };

    return (
        <Popover>
            <PopoverTrigger render={renderTrigger()}></PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" side="bottom" align="start" onWheel={(e) => e.stopPropagation()}>
                {(showSearch === true || items.length > 10) && (
                    <div className="p-2">
                        <Input
                            type="text"
                            placeholder={searchPlaceholder}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full px-2 py-1 text-sm border rounded"
                        />
                    </div>
                )}
                <div className="max-h-[300px] overflow-auto">
                    {filteredItems.map(item => (
                        <button
                            key={item.value}
                            onClick={() => handleSelect(item.value)}
                            className={cn(
                                'w-full px-2 py-1.5 text-sm text-left hover:bg-accent',
                                multiple && (value as string[]).includes(item.value) && 'bg-accent',
                            )}
                        >
                            {item.display ?? item.label}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
