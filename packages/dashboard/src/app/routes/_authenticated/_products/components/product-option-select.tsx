import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
    ComboboxValue,
} from '@/vdb/components/ui/combobox.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Plus } from 'lucide-react';
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
    const selected = group.options.find(option => option.id === value) ?? null;
    const name = group.name;
    const searchLabel = t`Search ${name}...`;

    return (
        <FormFieldWrapper
            control={undefined}
            name={`options.${group.id}`}
            label={group.name}
            render={() => (
                <Combobox
                    items={group.options}
                    value={selected}
                    onValueChange={(option: ProductOption | null) => {
                        if (option) {
                            onChange(option.id);
                        }
                    }}
                    open={open}
                    onOpenChange={setOpen}
                    inputValue={newOptionInput}
                    onInputValueChange={setNewOptionInput}
                    itemToStringLabel={(option: ProductOption) => option.name}
                    isItemEqualToValue={(a: ProductOption, b: ProductOption) => a.id === b.id}
                >
                    <ComboboxTrigger aria-label={group.name} className="w-full">
                        <ComboboxValue placeholder={t`Select ${group.name}`} />
                    </ComboboxTrigger>
                    <ComboboxContent>
                        <ComboboxInput
                            aria-label={searchLabel}
                            placeholder={searchLabel}
                            showTrigger={false}
                        />
                        <ComboboxEmpty className="p-1">
                            <Button
                                variant="ghost"
                                type="button"
                                className="w-full justify-start"
                                disabled={!newOptionInput.trim()}
                                onClick={() => {
                                    onCreateOption(newOptionInput.trim());
                                    setOpen(false);
                                }}
                            >
                                <Plus />
                                <Trans>Add "{newOptionInput}"</Trans>
                            </Button>
                        </ComboboxEmpty>
                        <ComboboxList>
                            {(option: ProductOption) => (
                                <ComboboxItem key={option.id} value={option}>
                                    {option.name}
                                </ComboboxItem>
                            )}
                        </ComboboxList>
                    </ComboboxContent>
                </Combobox>
            )}
        />
    );
}
