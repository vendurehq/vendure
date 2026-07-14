import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { extendDetailFormQuery } from '@/vdb/framework/document-extension/extend-detail-form-query.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import {    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { getDetailQueryOptions, useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { activeAdministratorDocument, updateAdministratorDocument } from './profile.graphql.js';

const pageId = 'profile';

export const Route = createFileRoute('/_authenticated/_profile/profile')({
    component: ProfilePage,
    loader: async ({ context }) => {
        const { extendedQuery } = extendDetailFormQuery(
            addCustomFields(activeAdministratorDocument),
            pageId,
        );
        await context.queryClient.ensureQueryData(
            getDetailQueryOptions(extendedQuery, { id: 'undefined' }),
            {},
        );
        return {
            breadcrumb: [{ path: '/profile', label: <Trans>Profile</Trans> }],
        };
    },
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function ProfilePage() {
    const { t } = useLingui();
    const { formatDate } = useLocalFormat();

    const { form, submitHandler, isPending, entity } = useDetailPage({
        queryDocument: activeAdministratorDocument,
        entityField: 'activeAdministrator',
        updateDocument: updateAdministratorDocument,
        pageId,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                firstName: entity.firstName,
                lastName: entity.lastName,
                emailAddress: entity.emailAddress,
                password: '',
                customFields: entity.customFields,
            };
        },
        transformUpdateInput: input => {
            return {
                ...input,
                password: input.password?.length ? input.password : undefined,
            };
        },
        params: { id: 'undefined' },
        onSuccess: async data => {
            toast(t`Successfully updated profile`);
            form.reset(form.getValues());
        },
        onError: err => {
            toast(t`Failed to update profile`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler}>
            <PageTitle>
                <Trans>Profile</Trans>
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button">
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        <Trans>Update</Trans>
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
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
                            label={<Trans>Email Address or identifier</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="password"
                            label={<Trans>Password</Trans>}
                            render={({ field }) => <Input type="password" {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock
                    column="side"
                    blockId="auth-methods"
                    title={<Trans>Authentication methods</Trans>}
                >
                    <div className="space-y-2">
                        {entity?.user?.authenticationMethods.map(method => (
                            <div
                                key={method.id}
                                className="flex items-center justify-between py-2 border-b last:border-b-0"
                            >
                                <Badge variant="secondary">
                                    {method.strategy === 'native' ? t`Password` : method.strategy}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                    <Trans>Added</Trans> {formatDate(method.createdAt)}
                                </span>
                            </div>
                        ))}
                    </div>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Administrator" control={form.control} />
            </PageLayout>
        </Page>
    );
}
