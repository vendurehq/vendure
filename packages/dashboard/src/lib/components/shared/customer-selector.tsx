import { Button } from '@/vdb/components/ui/button.js';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from '@/vdb/components/ui/combobox.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { api } from '@/vdb/graphql/api.js';
import { type CreateCustomerInput } from '@/vdb/graphql/common-operations.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { ComboboxPrimitive } from '@vendure-io/ui/lib/base-ui';
import { Plus, Users } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CustomFieldsForm } from './custom-fields-form.js';
import { FormFieldWrapper } from './form-field-wrapper.js';

const customersDocument = graphql(`
    query GetCustomers($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                firstName
                lastName
                emailAddress
            }
            totalItems
        }
    }
`);

export interface Customer {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
}

export interface CustomerSelectorProps {
    onSelect: (value: Customer) => void;
    /**
     * @description
     * When enabled, the selector renders a popover with tabs allowing the admin to either select an
     * existing customer or create a new one inline. When a new customer is submitted, `onCreateNew`
     * is called with the {@link CreateCustomerInput}.
     */
    allowCreateNew?: boolean;
    onCreateNew?: (input: CreateCustomerInput) => void | Promise<void>;
    label?: string | React.ReactNode;
    readOnly?: boolean;
}

const createCustomerFormSchema = z.object({
    title: z.string().optional(),
    firstName: z.string().min(1, { message: 'First name is required' }),
    lastName: z.string().min(1, { message: 'Last name is required' }),
    emailAddress: z.string().min(1, { message: 'Email address is required' }).email(),
    phoneNumber: z.string().optional(),
    customFields: z.any().optional(),
});

type CreateCustomerFormValues = z.infer<typeof createCustomerFormSchema>;

/**
 * Searches customers on the server. With a `trigger`, an outline button with that content opens
 * a popup that holds the search input; without one, the search input is shown in place and the
 * list opens under it.
 */
function CustomerSearch({
    onSelect,
    trigger,
    disabled,
}: Readonly<{ onSelect: (value: Customer) => void; trigger?: React.ReactNode; disabled?: boolean }>) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const anchor = useRef<HTMLButtonElement>(null);
    const labelId = useId();

    const { data, isFetching } = useQuery({
        queryKey: ['customers', debouncedSearchTerm],
        queryFn: () =>
            api.query(customersDocument, {
                options: {
                    sort: { lastName: 'ASC' },
                    filter: debouncedSearchTerm
                        ? {
                              firstName: { contains: debouncedSearchTerm },
                              lastName: { contains: debouncedSearchTerm },
                              emailAddress: { contains: debouncedSearchTerm },
                          }
                        : undefined,
                    filterOperator: debouncedSearchTerm ? 'OR' : undefined,
                },
            }),
    });

    const input = (
        <ComboboxInput
            aria-label={t`Search customers`}
            placeholder={t`Search customers...`}
            showTrigger={false}
            className={trigger ? undefined : 'w-full'}
        />
    );

    return (
        <Combobox
            items={data?.customers.items ?? []}
            filter={null}
            value={null}
            onValueChange={(customer: Customer | null) => {
                if (customer) {
                    onSelect(customer);
                    setOpen(false);
                    setSearchTerm('');
                }
            }}
            open={open}
            onOpenChange={setOpen}
            inputValue={searchTerm}
            onInputValueChange={setSearchTerm}
            itemToStringLabel={(customer: Customer) => `${customer.firstName} ${customer.lastName}`}
            isItemEqualToValue={(a: Customer, b: Customer) => a.id === b.id}
            isLoading={isFetching || searchTerm !== debouncedSearchTerm}
            disabled={disabled}
        >
            {trigger ? (
                <ComboboxPrimitive.Trigger
                    ref={anchor}
                    aria-labelledby={labelId}
                    render={<Button variant="outline" size="sm" type="button" className="gap-2" />}
                >
                    <span id={labelId} className="contents">
                        {trigger}
                    </span>
                </ComboboxPrimitive.Trigger>
            ) : (
                input
            )}
            <ComboboxContent anchor={trigger ? anchor : undefined} className={trigger ? 'w-80' : undefined}>
                {trigger ? input : null}
                <ComboboxEmpty>
                    <Trans>No customers found</Trans>
                </ComboboxEmpty>
                <ComboboxList>
                    {(customer: Customer) => (
                        <ComboboxItem key={customer.id} value={customer}>
                            <span className="flex min-w-0 flex-col">
                                <span className="font-medium">
                                    {customer.firstName} {customer.lastName}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {customer.emailAddress}
                                </span>
                            </span>
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}

function CreateCustomerForm({ onSubmit, onCancel }: Readonly<{ onSubmit: (input: CreateCustomerInput) => void; onCancel?: () => void }>) {
    const form = useForm<CreateCustomerFormValues>({
        resolver: zodResolver(createCustomerFormSchema),
        defaultValues: {
            title: '',
            firstName: '',
            lastName: '',
            emailAddress: '',
            phoneNumber: '',
            customFields: {},
        },
        mode: 'onChange',
    });

    return (
        <Form {...form}>
            <form
                onSubmit={e => {
                    e.stopPropagation();
                    form.handleSubmit(onSubmit)(e).catch(() => undefined);
                }}
                className="space-y-4"
            >
                <div className="grid grid-cols-1 gap-4">
                    <FormFieldWrapper
                        control={form.control}
                        name="title"
                        label={<Trans>Title</Trans>}
                        render={({ field }) => <Input {...field} value={field.value || ''} />}
                    />
                    <FormFieldWrapper
                        control={form.control}
                        name="firstName"
                        label={<Trans>First name</Trans>}
                        render={({ field }) => <Input {...field} value={field.value || ''} />}
                    />
                    <FormFieldWrapper
                        control={form.control}
                        name="lastName"
                        label={<Trans>Last name</Trans>}
                        render={({ field }) => <Input {...field} value={field.value || ''} />}
                    />
                    <FormFieldWrapper
                        control={form.control}
                        name="emailAddress"
                        label={<Trans>Email address</Trans>}
                        render={({ field }) => <Input {...field} value={field.value || ''} />}
                    />
                    <FormFieldWrapper
                        control={form.control}
                        name="phoneNumber"
                        label={<Trans>Phone number</Trans>}
                        render={({ field }) => <Input {...field} value={field.value || ''} />}
                    />
                </div>
                <CustomFieldsForm entityType="Customer" control={form.control} />
                <div className="flex justify-end gap-2 pt-2">
                    {onCancel && (
                        <Button type="button" variant="outline" onClick={onCancel}>
                            <Trans>Cancel</Trans>
                        </Button>
                    )}
                    <Button type="submit" disabled={!form.formState.isValid}>
                        <Trans>Create customer</Trans>
                    </Button>
                </div>
            </form>
        </Form>
    );
}

export function CustomerSelector(props: CustomerSelectorProps) {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('existing');

    const label = (
        <>
            <Plus className="h-4 w-4" />
            {props.label ?? <Trans>Select customer</Trans>}
        </>
    );

    // When inline creation is not enabled, the trigger opens the customer search directly.
    if (!props.allowCreateNew) {
        return (
            <CustomerSearch
                onSelect={props.onSelect}
                trigger={label}
                disabled={props.readOnly}
            />
        );
    }

    return (
        <Popover
            open={open}
            onOpenChange={(isOpen, eventDetails) => {
                // While the create tab is open, only our own submit/cancel may close the popover
                if (!isOpen && activeTab === 'new') {
                    return eventDetails.cancel();
                }
                setOpen(isOpen);
                if (!isOpen) {
                    setActiveTab('existing');
                }
            }}
        >
            <PopoverTrigger
                render={
                    <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={props.readOnly}
                        className="gap-2"
                    />
                }
            >
                {label}
            </PopoverTrigger>
            <PopoverContent className="w-[420px] p-0">
                <div className="p-4">
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="existing">
                                <Users className="mr-2 h-4 w-4" />
                                <Trans>Existing customer</Trans>
                            </TabsTrigger>
                            <TabsTrigger value="new">
                                <Plus className="mr-2 h-4 w-4" />
                                <Trans>Create new customer</Trans>
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="existing">
                            <div className="mt-2">
                                <CustomerSearch
                                    onSelect={customer => {
                                        props.onSelect(customer);
                                        setOpen(false);
                                        setActiveTab('existing');
                                    }}
                                />
                            </div>
                        </TabsContent>
                        <TabsContent value="new">
                            <div className="mt-2">
                                <CreateCustomerForm
                                    onSubmit={async input => {
                                        await props.onCreateNew?.(input);
                                        setOpen(false);
                                        setActiveTab('existing');
                                    }}
                                    onCancel={() => {
                                        setOpen(false);
                                        setActiveTab('existing');
                                    }}
                                />
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </PopoverContent>
        </Popover>
    );
}
