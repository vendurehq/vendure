import { AffixedInput } from '@/vdb/components/data-input/affixed-input.js';
import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { DetailFormGrid } from '@/vdb/framework/layout-engine/page-layout.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans } from '@lingui/react/macro';
import { VariablesOf } from 'gql.tada';
import { Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { modifyOrderDocument } from '../orders.graphql.js';

type ModifyOrderInput = VariablesOf<typeof modifyOrderDocument>['input'];
type SurchargeInput = NonNullable<ModifyOrderInput['surcharges']>[number];

const surchargeFormSchema = z.object({
    description: z.string().min(1),
    sku: z.string().optional(),
    price: z.string().refine(val => !Number.isNaN(Number(val)) && Number(val) > 0, {
        message: 'Price must be a positive number',
    }),
    priceIncludesTax: z.boolean(),
    taxRate: z.number().nonnegative().max(100),
    taxDescription: z.string().optional(),
});

type SurchargeFormValues = z.infer<typeof surchargeFormSchema>;

export interface AddSurchargeFormProps {
    onAddSurcharge: (surcharge: SurchargeInput) => void;
}

export function AddSurchargeForm({ onAddSurcharge }: Readonly<AddSurchargeFormProps>) {
    const { activeChannel } = useChannel();

    const surchargeForm = useForm<SurchargeFormValues>({
        resolver: zodResolver(surchargeFormSchema),
        mode: 'onChange',
        defaultValues: {
            description: '',
            sku: '',
            price: '0',
            priceIncludesTax: false,
            taxRate: 0,
            taxDescription: '',
        },
    });

    const taxRate = surchargeForm.watch('taxRate') || 0;

    const handleAddSurcharge = () => {
        surchargeForm.handleSubmit(values => {
            onAddSurcharge({
                description: values.description,
                sku: values.sku || undefined,
                price: Number(values.price), // already in minor units from MoneyInput
                priceIncludesTax: values.priceIncludesTax,
                taxRate: values.taxRate ?? undefined,
                taxDescription: values.taxDescription || undefined,
            });
            surchargeForm.reset();
        })();
    };

    return (
        <Form {...surchargeForm}>
            <div className="space-y-4">
                <DetailFormGrid>
                    <FormFieldWrapper
                        control={surchargeForm.control}
                        name="description"
                        label={<Trans>Description</Trans>}
                        render={({ field }) => <Input {...field} />}
                    />
                    <FormFieldWrapper
                        control={surchargeForm.control}
                        name="sku"
                        label={<Trans>SKU</Trans>}
                        render={({ field }) => <Input {...field} />}
                    />
                    <FormFieldWrapper
                        control={surchargeForm.control}
                        name="price"
                        label={<Trans>Price</Trans>}
                        render={({ field }) => (
                            <MoneyInput
                                {...field}
                                value={Number(field.value) || 0}
                                onChange={value => field.onChange(value.toString())}
                                currency={activeChannel?.defaultCurrencyCode}
                            />
                        )}
                    />
                    <FormFieldWrapper
                        control={surchargeForm.control}
                        name="priceIncludesTax"
                        label={<Trans>Includes tax at {taxRate}%</Trans>}
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                    <FormFieldWrapper
                        control={surchargeForm.control}
                        name="taxRate"
                        label={<Trans>Tax rate</Trans>}
                        render={({ field }) => (
                            <AffixedInput
                                {...field}
                                type="number"
                                suffix="%"
                                value={field.value}
                                onChange={e => field.onChange(e.target.valueAsNumber)}
                            />
                        )}
                    />
                    <FormFieldWrapper
                        control={surchargeForm.control}
                        name="taxDescription"
                        label={<Trans>Tax description</Trans>}
                        render={({ field }) => <Input {...field} />}
                    />
                </DetailFormGrid>
                <Button
                    type="button"
                    onClick={handleAddSurcharge}
                    disabled={!surchargeForm.formState.isValid}
                >
                    <Plus className="w-4 h-4 mr-2" />
                    <Trans>Add surcharge</Trans>
                </Button>
            </div>
        </Form>
    );
}
