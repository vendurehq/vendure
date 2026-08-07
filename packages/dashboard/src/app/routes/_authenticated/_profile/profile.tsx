import { AdministratorAvatar } from '@/vdb/components/shared/administrator-avatar.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { PasswordInput } from '@/vdb/components/ui/password-input.js';
import { extendDetailFormQuery } from '@/vdb/framework/document-extension/extend-detail-form-query.js';
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
import { getDetailQueryOptions, useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import {
    AdministratorAvatar as AdministratorAvatarData,
    CURRENT_ADMINISTRATOR_AVATAR_QUERY_KEY,
} from '@/vdb/providers/auth.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ImageUp, Trash2 } from 'lucide-react';
import { ChangeEvent } from 'react';
import { toast } from 'sonner';
import {
    activeAdministratorDocument,
    setActiveAdministratorAvatarDocument,
    updateAdministratorDocument,
} from './profile.graphql.js';

const pageId = 'profile';

export const Route = createFileRoute('/_authenticated/_profile/profile')({
    component: ProfilePage,
    loader: async ({ context }) => {
        const { extendedQuery } = extendDetailFormQuery(addCustomFields(activeAdministratorDocument), pageId);
        await context.queryClient.ensureQueryData(
            getDetailQueryOptions(extendedQuery, { id: 'undefined' }),
            {},
        );
        return {
            breadcrumb: [{ path: '/profile', label: <Trans>Profile</Trans> }],
        };
    },
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function ProfilePage() {
    const { t } = useLingui();
    const { formatDate } = useLocalFormat();
    const { refreshCurrentUser, user } = useAuth();
    const queryClient = useQueryClient();

    const avatarMutation = useMutation({
        mutationFn: (variables: { file: File | null }) =>
            api.mutate(setActiveAdministratorAvatarDocument, variables) as Promise<{
                setActiveAdministratorAvatar: { avatar: AdministratorAvatarData | null };
            }>,
        onSuccess: result => {
            queryClient.setQueryData(CURRENT_ADMINISTRATOR_AVATAR_QUERY_KEY, {
                activeAdministrator: {
                    avatar: result.setActiveAdministratorAvatar.avatar,
                },
            });
            refreshCurrentUser();
        },
        onError: err => {
            toast(t`Failed to update profile picture`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });

    const onAvatarSelected = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            avatarMutation.mutate({ file });
        }
        event.target.value = '';
    };

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
                            render={({ field }) => <PasswordInput {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock column="side" blockId="profile-picture" title={<Trans>Profile picture</Trans>}>
                    <div className="flex items-center gap-4">
                        <AdministratorAvatar
                            preview={user?.avatar?.preview}
                            name={entity ? `${entity.firstName} ${entity.lastName}` : undefined}
                            className="size-16"
                        />
                        <div className="flex flex-col gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={avatarMutation.isPending}
                                render={<label htmlFor="administrator-avatar-upload" />}
                            >
                                <ImageUp />
                                {user?.avatar ? <Trans>Replace</Trans> : <Trans>Upload</Trans>}
                            </Button>
                            <input
                                id="administrator-avatar-upload"
                                className="sr-only"
                                type="file"
                                accept="image/*"
                                onChange={onAvatarSelected}
                                disabled={avatarMutation.isPending}
                            />
                            {user?.avatar ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={avatarMutation.isPending}
                                    onClick={() => avatarMutation.mutate({ file: null })}
                                >
                                    <Trash2 />
                                    <Trans>Remove</Trans>
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                        <Trans>Your image is cropped to fit wherever it appears.</Trans>
                    </p>
                </PageBlock>
                <PageBlock column="side" blockId="auth-methods" title={<Trans>Authentication methods</Trans>}>
                    <div className="space-y-2">
                        {entity?.user?.authenticationMethods.map(method => (
                            <div
                                key={method.id}
                                className="flex items-center justify-between py-2 border-b last:border-b-0"
                            >
                                <Badge variant="default">
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
