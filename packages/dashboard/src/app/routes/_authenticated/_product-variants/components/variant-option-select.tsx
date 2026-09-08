import { ComboboxFreeText, ComboboxFreeTextItem } from '@/vdb/components/ui/combobox-free-text.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';

interface VariantOption {
    id: string;
    code: string;
    name: string;
}

interface VariantOptionGroup {
    id: string;
    code: string;
    name: string;
    options: VariantOption[];
}

type OptionItem = ComboboxFreeTextItem & { id: string };

interface VariantOptionSelectProps {
    group: VariantOptionGroup;
    /** The current free-text value for this group (the source of truth). */
    value: string;
    /** Fires on every keystroke and when a suggestion is picked. */
    onValueChange: (value: string) => void;
    /** Fires only when an existing option row is picked, with its option id. */
    onSelectOption: (optionId: string) => void;
    invalid?: boolean;
}

/**
 * Thin per-group wrapper around the design-system ComboboxFreeText. Free text is the
 * source of truth: pick an existing option to reassign (onSelectOption → id), or type a
 * new value that the parent creates on save. The parent owns validation and create-on-save;
 * this component only labels the field and pre-filters the group's options.
 */
export function VariantOptionSelect({
    group,
    value,
    onValueChange,
    onSelectOption,
    invalid,
}: Readonly<VariantOptionSelectProps>) {
    const { t } = useLingui();
    const fieldId = `variant-option-${group.id}`;
    const trimmed = value.trim();
    const filter = trimmed.toLowerCase();
    // The component does no client-side filtering, so pre-filter the group's options here.
    // While the value is untouched (empty, or exactly an existing option name) show the
    // full list so the admin can pick any option; only narrow once they start editing.
    const isUntouched = filter === '' || group.options.some(o => o.name.trim().toLowerCase() === filter);
    const items: OptionItem[] = group.options
        .filter(option => isUntouched || option.name.toLowerCase().includes(filter))
        .map(option => ({ value: option.name, label: option.name, id: option.id }));

    return (
        <Field>
            {/* The label doubles as a navigation link to the option group detail page —
                the option value is edited in the combobox below, not here. */}
            <FieldLabel htmlFor={fieldId}>
                <Link
                    to={`/option-groups/${group.id}`}
                    className="inline-flex items-center gap-1 hover:underline"
                    title={t`Go to option group`}
                >
                    {group.name}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                </Link>
            </FieldLabel>
            <ComboboxFreeText<OptionItem>
                id={fieldId}
                value={value}
                onValueChange={onValueChange}
                onSelectItem={item => onSelectOption(item.id)}
                items={items}
                invalid={invalid}
                placeholder={t`Select or create ${group.name}`}
            />
        </Field>
    );
}
