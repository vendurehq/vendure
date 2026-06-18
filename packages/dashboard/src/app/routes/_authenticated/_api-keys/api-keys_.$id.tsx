import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { RoleSelector } from '@/vdb/components/shared/role-selector.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { MultiSelect } from '@/vdb/components/shared/multi-select.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useState } from 'react';
import {
    activeAdministratorRolesDocument,
    apiKeyDetailDocument,
    createApiKeyDocument,
    updateApiKeyDocument,
} from './api-keys.graphql.js';
import { ApiKeySecretDialog } from './components/api-key-secret-dialog.js';
import { RotateApiKeyButton } from './components/rotate-api-key-button.js';

const pageId = 'api-key-detail';

export const Route = createFileRoute('/_authenticated/_api-keys/api-keys_/$id')({
    component: ApiKeyDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: apiKeyDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/api-keys', label: <Trans>API Keys</Trans> },
                isNew ? <Trans>New API Key</Trans> : entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function ApiKeyDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { formatDate, formatRelativeDate } = useLocalFormat();

    const { hasPermissions } = usePermissions();
    const isSuperAdmin = hasPermissions(['SuperAdmin']);

    const [secretDialogOpen, setSecretDialogOpen] = useState(false);
    const [generatedApiKey, setGeneratedApiKey] = useState('');
    const [generatedLookupId, setGeneratedLookupId] = useState<string | undefined>();

    // Non-SuperAdmin users can only assign their own roles to API keys.
    // SuperAdmin can assign any role, so we use the standard RoleSelector.
    const { data: adminRoles } = useQuery({
        queryKey: ['activeAdministratorRoles'],
        queryFn: () => api.query(activeAdministratorRolesDocument, {}),
        select: data => data.activeAdministrator?.user.roles ?? [],
        enabled: !isSuperAdmin,
    });

    const availableRoles = (adminRoles ?? []).map(role => ({
        value: role.id,
        label: role.code,
        display: role.description || role.code,
    }));

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: apiKeyDetailDocument,
        createDocument: createApiKeyDocument,
        updateDocument: updateApiKeyDocument,
        setValuesForUpdate: entity => ({
            id: entity.id,
            roleIds: entity.user.roles.map(role => role.id),
            translations: entity.translations.map(t => ({
                id: t.id,
                languageCode: t.languageCode,
                name: t.name,
            })),
            customFields: entity.customFields,
        }),
        params: { id: params.id },
        onSuccess: async data => {
            if (creatingNewEntity) {
                // The createApiKey mutation returns { apiKey, entityId } instead of the
                // standard { id } shape, because the secret is only available at creation
                // time (it's hashed in the DB and never retrievable again). We need to
                // show the secret dialog before navigating to the detail page.
                const result = data as unknown as { apiKey: string; entityId: string };
                toast.success(t`Successfully created API key`);
                setGeneratedApiKey(result.apiKey);
                setGeneratedLookupId(undefined);
                setSecretDialogOpen(true);
                resetForm();
                await navigate({ to: `../$id`, params: { id: result.entityId } });
            } else {
                toast.success(t`Successfully updated API key`);
                resetForm();
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity ? t`Failed to create API key` : t`Failed to update API key`,
                { description: err instanceof Error ? err.message : 'Unknown error' },
            );
        },
    });

    const handleRotateSuccess = (newApiKey: string) => {
        setGeneratedApiKey(newApiKey);
        setGeneratedLookupId(entity?.lookupId);
        setSecretDialogOpen(true);
    };

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? <Trans>New API Key</Trans> : (entity?.name ?? '')}
            </PageTitle>
            <PageActionBar>
                {!creatingNewEntity && (
                    <ActionBarItem itemId="rotate-button" requiresPermission={['UpdateApiKey']}>
                        <RotateApiKeyButton
                            apiKeyId={params.id}
                            onSuccess={handleRotateSuccess}
                        />
                    </ActionBarItem>
                )}
                <ActionBarItem
                    itemId="save-button"
                    requiresPermission={[creatingNewEntity ? 'CreateApiKey' : 'UpdateApiKey']}
                >
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
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Name</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock column="main" blockId="roles" title={<Trans>Roles</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="roleIds"
                        render={({ field }) =>
                            isSuperAdmin ? (
                                <RoleSelector
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                    multiple={true}
                                />
                            ) : (
                                <MultiSelect
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                    multiple={true}
                                    items={availableRoles}
                                    placeholder={t`Select roles`}
                                    searchPlaceholder={t`Search roles...`}
                                />
                            )
                        }
                    />
                    {!isSuperAdmin && (
                        <p className="text-xs text-muted-foreground mt-2">
                            <Trans>Only roles assigned to your account are available.</Trans>
                        </p>
                    )}
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="ApiKey" control={form.control} />
                {!creatingNewEntity && entity && (
                    <PageBlock column="side" blockId="metadata" title={<Trans>Metadata</Trans>}>
                        <div className="space-y-4 text-sm">
                            <div>
                                <div className="text-muted-foreground mb-1"><Trans>Lookup ID</Trans></div>
                                <CopyableText value={entity.lookupId}>
                                    <code className="font-mono text-xs">{entity.lookupId}</code>
                                </CopyableText>
                            </div>
                            <div>
                                <div className="text-muted-foreground mb-1"><Trans>Created by</Trans></div>
                                <div>{entity.owner?.identifier ?? '-'}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground mb-1"><Trans>Last used</Trans></div>
                                <div>
                                    {entity.lastUsedAt ? (
                                        <time title={formatDate(new Date(entity.lastUsedAt))}>
                                            {formatRelativeDate(new Date(entity.lastUsedAt))}
                                        </time>
                                    ) : (
                                        <span className="text-muted-foreground"><Trans>Never</Trans></span>
                                    )}
                                </div>
                            </div>
                            <div>
                                <div className="text-muted-foreground mb-1"><Trans>Created</Trans></div>
                                <div>{formatDate(new Date(entity.createdAt))}</div>
                            </div>
                        </div>
                    </PageBlock>
                )}
            </PageLayout>

            <ApiKeySecretDialog
                open={secretDialogOpen}
                apiKey={generatedApiKey}
                lookupId={generatedLookupId}
                onClose={() => setSecretDialogOpen(false)}
            />
        </Page>
    );
}
