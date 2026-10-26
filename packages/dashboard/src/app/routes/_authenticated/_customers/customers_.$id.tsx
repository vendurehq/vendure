import { CustomerGroupChip } from '@/vdb/components/shared/customer-group-chip.js';
import { CustomerGroupSelector } from '@/vdb/components/shared/customer-group-selector.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CustomerAddressCard } from './components/customer-address-card.js';
import { CustomerAddressForm } from './components/customer-address-form.js';
import { CustomerHistoryContainer } from './components/customer-history/customer-history-container.js';
import { customerHistoryQueryKey } from './components/customer-history/use-customer-history.js';
import { CustomerOrderTable } from './components/customer-order-table.js';
import { CustomerStatusBadge } from './components/customer-status-badge.js';
import {
    addCustomerToGroupDocument,
    createCustomerAddressDocument,
    createCustomerDocument,
    customerDetailDocument,
    removeCustomerFromGroupDocument,
    updateCustomerDocument,
    verifyCustomerAccountDocument,
} from './customers.graphql.js';

const pageId = 'customer-detail';

/**
 * The `message` of a PasswordValidationError is the generic "Password is invalid"; the configured
 * policy that the password actually broke is in `validationErrorMessage`.
 */
function errorResultDescription(result: { message: string; validationErrorMessage?: string }): string {
    return result.validationErrorMessage ?? result.message;
}

export const Route = createFileRoute('/_authenticated/_customers/customers_/$id')({
    component: CustomerDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: () =>
            addCustomFields(customerDetailDocument, {
                includeNestedFragments: ['Address'],
            }),
        breadcrumb: (isNew, entity) => [
            { path: '/customers', label: <Trans>Customers</Trans> },
            isNew ? <Trans>New customer</Trans> : `${entity?.firstName} ${entity?.lastName}`,
        ],
    }),
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function CustomerDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const [newAddressOpen, setNewAddressOpen] = useState(false);
    const [newCustomerPassword, setNewCustomerPassword] = useState('');

    const { form, submitHandler, entity, isPending, refreshEntity, resetForm } = useDetailPage({
        pageId,
        queryDocument: addCustomFields(customerDetailDocument, {
            includeNestedFragments: ['Address'],
        }),
        createDocument: createCustomerDocument,
        updateDocument: updateCustomerDocument,
        // The password is a `createCustomer` argument of its own rather than a field of
        // `CreateCustomerInput`, so it is held outside the generated form and attached here.
        transformCreateVariables: variables => ({
            ...variables,
            password: newCustomerPassword || undefined,
        }),
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                title: entity.title,
                emailAddress: entity.emailAddress,
                firstName: entity.firstName,
                lastName: entity.lastName,
                phoneNumber: entity.phoneNumber,
                addresses: entity.addresses,
                customFields: entity.customFields,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            if (data.__typename === 'Customer') {
                toast.success(
                    creatingNewEntity ? t`Successfully created customer` : t`Successfully updated customer`,
                );
                resetForm();
                if (creatingNewEntity) {
                    await navigate({ to: `../$id`, params: { id: data.id } });
                } else {
                    await queryClient.invalidateQueries({ queryKey: customerHistoryQueryKey(data.id) });
                }
            } else {
                toast.error(creatingNewEntity ? t`Failed to create customer` : t`Failed to update customer`, {
                    description: errorResultDescription(data),
                });
            }
        },
        onError: err => {
            toast.error(creatingNewEntity ? t`Failed to create customer` : t`Failed to update customer`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    const { mutate: createAddress } = useMutation({
        mutationFn: api.mutate(createCustomerAddressDocument),
        onSuccess: () => {
            setNewAddressOpen(false);
            refreshEntity();
        },
        onError: () => {
            toast.error(t`Failed to create address`);
        },
    });

    const { mutate: addCustomerToGroup } = useMutation({
        mutationFn: api.mutate(addCustomerToGroupDocument),
        onSuccess: () => {
            refreshEntity();
        },
        onError: () => {
            toast(t`Failed to add customer to group`);
        },
    });

    const { mutate: removeCustomerFromGroup } = useMutation({
        mutationFn: api.mutate(removeCustomerFromGroupDocument),
        onSuccess: () => {
            refreshEntity();
        },
        onError: () => {
            toast(t`Failed to remove customer from group`);
        },
    });

    const customerName = entity ? `${entity.firstName} ${entity.lastName}` : '';

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New customer</Trans> : customerName}</PageTitle>
            <PageActionBar>
                {entity?.user && !entity.user.verified && (
                    <ActionBarItem itemId="verify-button" requiresPermission={['UpdateCustomer']}>
                        <VerifyAccountDialog customerId={entity.id} onVerified={refreshEntity} />
                    </ActionBarItem>
                )}
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateCustomer']}>
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="title"
                            label={<Trans>Title</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <div></div>
                        <FormFieldWrapper
                            control={form.control}
                            name="firstName"
                            label={<Trans>First name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="lastName"
                            label={<Trans>Last name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="emailAddress"
                            label={<Trans>Email address</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="phoneNumber"
                            label={<Trans>Phone number</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        {/* Not a FormFieldWrapper: the generated form is built from
                            CreateCustomerInput, which has no password field. */}
                        {creatingNewEntity && (
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="new-customer-password">
                                    <Trans>Password</Trans>
                                </Label>
                                <Input
                                    id="new-customer-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={newCustomerPassword}
                                    onChange={e => setNewCustomerPassword(e.target.value)}
                                />
                                <p className="text-muted-foreground text-sm">
                                    <Trans>
                                        Setting a password here verifies the account immediately. Left empty,
                                        the customer has no password and cannot log in until they set one.
                                    </Trans>
                                </p>
                            </div>
                        )}
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Customer" control={form.control} />

                {entity && (
                    <>
                        <PageBlock column="main" blockId="addresses" title={<Trans>Addresses</Trans>}>
                            <DetailFormGrid>
                                {entity?.addresses?.map(address => (
                                    <CustomerAddressCard
                                        key={address.id}
                                        address={address}
                                        editable
                                        deletable
                                        onUpdate={() => {
                                            refreshEntity();
                                        }}
                                        onDelete={() => {
                                            refreshEntity();
                                        }}
                                    />
                                ))}
                            </DetailFormGrid>

                            <Dialog open={newAddressOpen} onOpenChange={setNewAddressOpen}>
                                <DialogTrigger render={<Button variant="outline" />}>
                                    <Plus className="w-4 h-4" /> <Trans>Add new address</Trans>
                                </DialogTrigger>
                                <DialogContent className="max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                        <DialogTitle>
                                            <Trans>Add new address</Trans>
                                        </DialogTitle>
                                        <DialogDescription>
                                            <Trans>Add a new address to the customer.</Trans>
                                        </DialogDescription>
                                    </DialogHeader>
                                    <CustomerAddressForm
                                        onSubmit={values => {
                                            const { id, ...input } = values;
                                            createAddress({
                                                customerId: entity.id,
                                                input,
                                            });
                                        }}
                                    />
                                </DialogContent>
                            </Dialog>
                        </PageBlock>

                        <PageBlock column="main" blockId="orders" layout="bare">
                            <CustomerOrderTable customerId={entity.id} title={<Trans>Orders</Trans>} />
                        </PageBlock>
                        <PageBlock column="main" blockId="history" title={<Trans>Customer history</Trans>}>
                            <CustomerHistoryContainer customerId={entity.id} />
                        </PageBlock>
                        <PageBlock column="side" blockId="status" title={<Trans>Status</Trans>}>
                            <CustomerStatusBadge user={entity.user} />
                        </PageBlock>
                        <PageBlock column="side" blockId="groups" title={<Trans>Customer groups</Trans>}>
                            <div
                                className={`flex flex-col gap-2 ${entity?.groups?.length > 0 ? 'mb-2' : ''}`}
                            >
                                {entity?.groups?.map(group => (
                                    <CustomerGroupChip
                                        key={group.id}
                                        group={group}
                                        onRemove={groupId =>
                                            removeCustomerFromGroup({ customerId: entity.id, groupId })
                                        }
                                    />
                                ))}
                            </div>
                            <CustomerGroupSelector
                                onSelect={group =>
                                    addCustomerToGroup({ customerId: entity.id, groupId: group.id })
                                }
                            />
                        </PageBlock>
                    </>
                )}
            </PageLayout>
        </Page>
    );
}

/**
 * Verifies a Customer's account without the customer having to use a verification email.
 *
 * The `Customer` type has no field for whether a password is already set, which is what decides
 * whether one has to be supplied here. So the field is optional, and the server returns a
 * `MissingPasswordError` or a `PasswordAlreadySetError`, which the dialog shows next to the field
 * with itself still open.
 */
function VerifyAccountDialog({ customerId, onVerified }: { customerId: string; onVerified: () => void }) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string>();

    function reset() {
        setPassword('');
        setError(undefined);
    }

    const { mutate: verifyCustomer, isPending } = useMutation({
        mutationFn: api.mutate(verifyCustomerAccountDocument),
        onSuccess: ({ verifyCustomerAccount: result }: ResultOf<typeof verifyCustomerAccountDocument>) => {
            if (result.__typename !== 'Customer') {
                setError(errorResultDescription(result));
                return;
            }
            toast.success(t`Customer account verified`);
            setOpen(false);
            reset();
            onVerified();
        },
        onError: err => {
            setError(err instanceof Error ? err.message : t`Unknown error`);
        },
    });

    return (
        <Dialog
            open={open}
            onOpenChange={nextOpen => {
                setOpen(nextOpen);
                if (!nextOpen) {
                    reset();
                }
            }}
        >
            <DialogTrigger render={<Button type="button" variant="secondary" />}>
                <Trans>Verify account</Trans>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Verify account</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Marks the account as verified without the customer having to use a verification
                            email.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="verify-password">
                        <Trans>Password</Trans>
                    </Label>
                    <Input
                        id="verify-password"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        aria-invalid={!!error || undefined}
                        onChange={e => {
                            setPassword(e.target.value);
                            setError(undefined);
                        }}
                    />
                    <p className="text-muted-foreground text-sm">
                        <Trans>
                            Needed only for a customer who has no password yet, since that account cannot be
                            logged into. Leave empty for a customer who already has one.
                        </Trans>
                    </p>
                    {error && (
                        <p className="text-destructive text-sm" data-testid="verify-account-error">
                            {error}
                        </p>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose render={<Button type="button" variant="secondary" />}>
                        <Trans>Cancel</Trans>
                    </DialogClose>
                    <Button
                        type="button"
                        disabled={isPending}
                        onClick={() => verifyCustomer({ id: customerId, password: password || undefined })}
                    >
                        <Trans>Verify</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
