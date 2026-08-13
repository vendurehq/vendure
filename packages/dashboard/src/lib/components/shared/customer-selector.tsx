import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { LoadingState } from '@/vdb/components/ui/state-views.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { api } from '@/vdb/graphql/api.js';
import { type CreateCustomerInput } from '@/vdb/graphql/common-operations.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Plus, Users } from 'lucide-react';
import { useState } from 'react';
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

function CustomerSearch({ onSelect }: Readonly<{ onSelect: (value: Customer) => void }>) {
    const { t } = useLingui();
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const { data, isLoading } = useQuery({
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
        staleTime: 1000 * 60, // 1 minute
    });

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t`Search customers...`}
                onValueChange={setSearchTerm}
                className="h-10 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
            <CommandList>
                <CommandEmpty>
                    {isLoading ? (
                        <LoadingState variant="spinner" className="py-4" />
                    ) : (
                        <Trans>No customers found</Trans>
                    )}
                </CommandEmpty>
                {data?.customers.items.map(customer => (
                    <CommandItem
                        key={customer.id}
                        onSelect={() => onSelect(customer)}
                        className="flex flex-col items-start"
                    >
                        <div className="font-medium">
                            {customer.firstName} {customer.lastName}
                        </div>
                        <div className="text-sm text-muted-foreground">{customer.emailAddress}</div>
                    </CommandItem>
                ))}
            </CommandList>
        </Command>
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

    const trigger = (
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
            <Plus className="h-4 w-4" />
            {props.label ?? <Trans>Select customer</Trans>}
        </PopoverTrigger>
    );

    // When inline creation is not enabled, preserve the original lightweight popover behaviour.
    if (!props.allowCreateNew) {
        return (
            <Popover open={open} onOpenChange={setOpen}>
                {trigger}
                <PopoverContent className="p-0 w-[350px]" align="start">
                    <CustomerSearch
                        onSelect={customer => {
                            props.onSelect(customer);
                            setOpen(false);
                        }}
                    />
                </PopoverContent>
            </Popover>
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
            {trigger}
            <PopoverContent className="w-[420px] p-0" align="start">
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
                            <div className="mt-2 rounded-md border">
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
