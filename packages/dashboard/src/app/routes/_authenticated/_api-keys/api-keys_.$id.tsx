import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { DEFAULT_CHANNEL_CODE, NEW_ENTITY_PATH } from '@/vdb/constants.js';
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
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
    completeRoleAssignmentPairs,
    RoleAssignmentPair,
} from '../_administrators/components/role-assignments-editor.js';
import { RolesPageBlock } from '../_administrators/components/roles-page-block.js';
import { apiKeyDetailDocument, createApiKeyDocument, updateApiKeyDocument } from './api-keys.graphql.js';
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
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function ApiKeyDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { formatDate, formatRelativeDate } = useLocalFormat();

    const [secretDialogOpen, setSecretDialogOpen] = useState(false);
    const [generatedApiKey, setGeneratedApiKey] = useState('');
    const [generatedLookupId, setGeneratedLookupId] = useState<string | undefined>();

    const { form, submitHandler, entity, isPending, resetForm, refreshEntity } = useDetailPage({
        pageId,
        queryDocument: apiKeyDetailDocument,
        createDocument: createApiKeyDocument,
        updateDocument: updateApiKeyDocument,
        setValuesForUpdate: entity => ({
            id: entity.id,
            translations: entity.translations.map(t => ({
                id: t.id,
                languageCode: t.languageCode,
                name: t.name,
            })),
            customFields: entity.customFields,
        }),
        // The generated form seeds the deprecated roleIds list with []; sent as-is it would
        // strip the roles on the active channel. roleIds is also mutually exclusive with
        // roleAssignments on creation. Incomplete editor rows must not reach the input.
        transformCreateInput: input => {
            const transformed = {
                ...input,
                roleAssignments: completeRoleAssignmentPairs(input.roleAssignments),
            };
            delete transformed.roleIds;
            return transformed;
        },
        transformUpdateInput: input => {
            const transformed = { ...input };
            delete transformed.roleIds;
            return transformed;
        },
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
            toast.error(creatingNewEntity ? t`Failed to create API key` : t`Failed to update API key`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    // useDetailPage types the form on the update input, and roleAssignments is a creation
    // input only: once the API key exists, assignments are edited through their own
    // mutations (RolesPageBlock), not through updateApiKey.
    const createForm = form as unknown as UseFormReturn<{ roleAssignments: RoleAssignmentPair[] }>;
    // An API key belongs to the Channel it was created on and to the default Channel, and it is
    // read here through one of them, so these two are always among its Channels. A key created on
    // another Channel and read from the default Channel gets its grants there by switching to it.
    const { activeChannel, channels } = useChannel();
    const defaultChannelId = channels.find(channel => channel.code === DEFAULT_CHANNEL_CODE)?.id;
    const apiKeyChannelIds = [activeChannel?.id, defaultChannelId].filter((id): id is string => !!id);

    const handleRotateSuccess = (newApiKey: string) => {
        setGeneratedApiKey(newApiKey);
        setGeneratedLookupId(entity?.lookupId);
        setSecretDialogOpen(true);
    };

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New API Key</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                {!creatingNewEntity && (
                    <ActionBarItem itemId="rotate-button" requiresPermission={['UpdateApiKey']}>
                        <RotateApiKeyButton apiKeyId={params.id} onSuccess={handleRotateSuccess} />
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
                <RolesPageBlock
                    column="main"
                    createForm={creatingNewEntity ? createForm : undefined}
                    user={entity?.user}
                    onChange={refreshEntity}
                    apiKeyChannelIds={apiKeyChannelIds}
                />
                <CustomFieldsPageBlock column="main" entityType="ApiKey" control={form.control} />
                {!creatingNewEntity && entity && (
                    <PageBlock column="side" blockId="metadata" title={<Trans>Metadata</Trans>}>
                        <div className="space-y-4 text-sm">
                            <div>
                                <div className="text-muted-foreground mb-1">
                                    <Trans>Lookup ID</Trans>
                                </div>
                                <CopyableText value={entity.lookupId}>
                                    <code className="font-mono text-xs">{entity.lookupId}</code>
                                </CopyableText>
                            </div>
                            <div>
                                <div className="text-muted-foreground mb-1">
                                    <Trans>Created by</Trans>
                                </div>
                                <div>{entity.owner?.identifier ?? '-'}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground mb-1">
                                    <Trans>Last used</Trans>
                                </div>
                                <div>
                                    {entity.lastUsedAt ? (
                                        <time title={formatDate(new Date(entity.lastUsedAt))}>
                                            {formatRelativeDate(new Date(entity.lastUsedAt))}
                                        </time>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            <Trans>Never</Trans>
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div>
                                <div className="text-muted-foreground mb-1">
                                    <Trans>Created</Trans>
                                </div>
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
