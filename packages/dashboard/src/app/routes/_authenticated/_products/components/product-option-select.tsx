import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';

interface ProductOption {
    id: string;
    code: string;
    name: string;
}

interface ProductOptionGroup {
    id: string;
    code: string;
    name: string;
    options: ProductOption[];
}

interface ProductOptionSelectProps {
    group: ProductOptionGroup;
    value: string;
    onChange: (value: string) => void;
    onCreateOption: (name: string) => void;
}

export function ProductOptionSelect({
    group,
    value,
    onChange,
    onCreateOption,
}: Readonly<ProductOptionSelectProps>) {
    const [open, setOpen] = useState(false);
    const [newOptionInput, setNewOptionInput] = useState('');
    const { t } = useLingui();

    return (
        <FormFieldWrapper
            control={undefined}
            name={`options.${group.id}`}
            label={group.name}
            render={() => (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger render={<Button variant="outline" role="combobox" className="w-full justify-between" />}>
                            {value ? (
                                group.options.find(option => option.id === value)?.name
                            ) : (
                                <Trans>Select {group.name}</Trans>
                            )}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                        <Command>
                            <CommandInput
                                placeholder={t`Search {name}...`.replace('{name}', group.name)}
                                onValueChange={setNewOptionInput}
                            />
                            <CommandEmpty className="py-2">
                                <div className="p-2">
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start"
                                        onClick={() => {
                                            if (newOptionInput) {
                                                onCreateOption(newOptionInput);
                                            }
                                        }}
                                    >
                                        <Plus className="mr-2 h-4 w-4" />
                                        <Trans>Add "{newOptionInput}"</Trans>
                                    </Button>
                                </div>
                            </CommandEmpty>
                            <CommandGroup>
                                {group.options.map(option => (
                                    <CommandItem
                                        key={option.id}
                                        value={option.name}
                                        onSelect={() => {
                                            onChange(option.id);
                                            setOpen(false);
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                'mr-2 h-4 w-4',
                                                value === option.id ? 'opacity-100' : 'opacity-0',
                                            )}
                                        />
                                        {option.name}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </Command>
                    </PopoverContent>
                </Popover>
            )}
        />
    );
}
