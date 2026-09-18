import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Trans } from '@lingui/react/macro';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { Control, FieldValues, useFieldArray, useForm } from 'react-hook-form';
import { OptionValueInput } from './option-value-input.js';

export const optionValueSchema = z.object({
    value: z.string().min(1, { message: 'Value cannot be empty' }),
    id: z.string().min(1, { message: 'Value cannot be empty' }),
});

export const optionGroupSchema = z.object({
    name: z.string().min(1, { message: 'Option name is required' }),
    values: z.array(optionValueSchema).min(1, { message: 'At least one value is required' }),
});

const multiGroupFormSchema = z.object({
    optionGroups: z.array(optionGroupSchema),
});

export type OptionGroup = z.infer<typeof optionGroupSchema>;
export type MultiGroupForm = z.infer<typeof multiGroupFormSchema>;

export interface SingleOptionGroup {
    name: string;
    values: Array<{
        value: string;
        id: string;
    }>;
}

export interface OptionGroupConfiguration {
    optionGroups: SingleOptionGroup[];
}


interface SingleOptionGroupEditorProps<TFieldValues extends FieldValues> {
    control: Control<TFieldValues, any, any>;
    fieldArrayPath: string;
    disabled?: boolean;
}

// Generic on purpose: since react-hook-form 7.72.0, `Control._options.validate` is compared
// contravariantly, so a form's `Control<T>` is not assignable to `Control<any, any>`.
export function SingleOptionGroupEditor<TFieldValues extends FieldValues>({
    control: formControl,
    fieldArrayPath,
    disabled,
}: Readonly<SingleOptionGroupEditorProps<TFieldValues>>) {
    // fieldArrayPath is a runtime string, so the field names cannot be checked against the
    // form's field types.
    const control = formControl as Control<any>;
    const { fields, append, remove } = useFieldArray({
        control,
        name: fieldArrayPath ? `${fieldArrayPath}.values` : 'values',
    });

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-[1fr_2fr] gap-4 items-start">
                <div>
                    <FormFieldWrapper
                        control={control}
                        name={fieldArrayPath ? `${fieldArrayPath}.name` : 'name'}
                        label={<Trans>Option Group Name</Trans>}
                        render={({ field }) => <Input placeholder="e.g. Size" {...field} />}
                    />
                </div>

                <div>
                    <FormFieldWrapper
                        control={control}
                        name={fieldArrayPath ? `${fieldArrayPath}.values` : 'values'}
                        label={<Trans>Option Values</Trans>}
                        render={({ field }) => (
                            <OptionValueInput
                                fields={fields as any}
                                onAdd={append}
                                onRemove={remove}
                                disabled={disabled}
                            />
                        )}
                    />
                </div>
            </div>
        </div>
    );
}

// Multi Option Groups Editor - for use in create product variants
interface OptionGroupsEditorProps {
    onChange?: (data: OptionGroupConfiguration) => void;
    initialGroups?: OptionGroupConfiguration['optionGroups'];
}

export function OptionGroupsEditor({ onChange, initialGroups = [] }: Readonly<OptionGroupsEditorProps>) {
    const form = useForm<MultiGroupForm>({
        resolver: zodResolver(multiGroupFormSchema),
        defaultValues: {
            optionGroups: initialGroups.length > 0 ? initialGroups : [],
        },
        mode: 'onChange',
    });

    const { control } = form;
    const {
        fields: optionGroups,
        append: appendOptionGroup,
        remove: removeOptionGroup,
    } = useFieldArray({
        control,
        name: 'optionGroups',
    });

    // Watch for changes and notify parent
    useEffect(() => {
        const subscription = form.watch(value => {
            if (value?.optionGroups) {
                const allOptionGroups: SingleOptionGroup[] = value.optionGroups
                    .filter((g): g is NonNullable<typeof g> => !!g)
                    .map(g => ({
                        name: g.name ?? '',
                        values: (g.values ?? [])
                            .filter((v): v is NonNullable<typeof v> => !!v)
                            .filter(v => typeof v.value === 'string' && typeof v.id === 'string')
                            .map(v => ({ value: v.value!, id: v.id! })),
                    }));

                onChange?.({ optionGroups: allOptionGroups });
            }
        });

        return () => subscription.unsubscribe();
    }, [form, onChange]);

    const handleAddOptionGroup = () => {
        appendOptionGroup({ name: '', values: [] });
    };

    return (
        <Form {...form}>
            <div className="space-y-4">
                {optionGroups.map((group, index) => (
                    <div key={group.id} className="flex items-start">
                        <SingleOptionGroupEditor control={control} fieldArrayPath={`optionGroups.${index}`} />
                        <div className="shrink-0 mt-6">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeOptionGroup(index)}
                                title="Remove Option"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                ))}

                <Button type="button" variant="secondary" onClick={handleAddOptionGroup}>
                    <Plus className="mr-2 h-4 w-4" />
                    <Trans>Add Option</Trans>
                </Button>
            </div>
        </Form>
    );
}
