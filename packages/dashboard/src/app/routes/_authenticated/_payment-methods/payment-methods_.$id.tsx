import { RichTextInput } from '@/vdb/components/data-input/rich-text-input.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import {    CustomFieldsPageBlock,
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
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { PaymentEligibilityCheckerSelector } from './components/payment-eligibility-checker-selector.js';
import { PaymentHandlerSelector } from './components/payment-handler-selector.js';
import {
    createPaymentMethodDocument,
    paymentMethodDetailDocument,
    updatePaymentMethodDocument,
} from './payment-methods.graphql.js';

const pageId = 'payment-method-detail';

export const Route = createFileRoute('/_authenticated/_payment-methods/payment-methods_/$id')({
    component: PaymentMethodDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: paymentMethodDetailDocument,
        breadcrumb(_isNew, entity) {
            return [
                { path: '/payment-methods', label: <Trans>Payment Methods</Trans> },
                _isNew ? <Trans>New payment method</Trans> : entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function PaymentMethodDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: paymentMethodDetailDocument,
        createDocument: createPaymentMethodDocument,
        updateDocument: updatePaymentMethodDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                enabled: entity.enabled,
                name: entity.name,
                code: entity.code,
                description: entity.description,
                checker: entity.checker?.code
                    ? {
                          code: entity.checker?.code,
                          arguments: entity.checker?.args,
                      }
                    : null,
                handler: entity.handler?.code
                    ? {
                          code: entity.handler?.code,
                          arguments: entity.handler?.args,
                      }
                    : null,
                translations: entity.translations.map(translation => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    name: translation.name,
                    description: translation.description,
                    customFields: (translation as any).customFields,
                })),
                customFields: entity.customFields,
            };
        },
        transformCreateInput: input => {
            return {
                ...input,
                checker: input.checker?.code ? input.checker : undefined,
                handler: input.handler,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created payment method`
                    : t`Successfully updated payment method`,
            );
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity ? t`Failed to create payment method` : t`Failed to update payment method`,
                {
                    description: err instanceof Error ? err.message : 'Unknown error',
                },
            );
        },
    });

    const [checkerArgsValid, setCheckerArgsValid] = useState(true);
    const [handlerArgsValid, setHandlerArgsValid] = useState(true);

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? <Trans>New payment method</Trans> : (entity?.name ?? '')}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdatePaymentMethod']}>
                    <Button
                        type="submit"
                        disabled={
                            !form.formState.isDirty ||
                            !form.formState.isValid ||
                            isPending ||
                            !checkerArgsValid ||
                            !handlerArgsValid
                        }
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="enabled">
                    <FormFieldWrapper
                        control={form.control}
                        name="enabled"
                        label={<Trans>Enabled</Trans>}
                        render={({ field }) => (
                            <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Code</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                    <TranslatableFormFieldWrapper
                        control={form.control}
                        name="description"
                        label={<Trans>Description</Trans>}
                        render={({ field }) => <RichTextInput {...field} />}
                    />
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="PaymentMethod" control={form.control} />
                <PageBlock
                    column="main"
                    blockId="payment-eligibility-checker"
                    title={<Trans>Payment eligibility checker</Trans>}
                >
                    <FormFieldWrapper
                        control={form.control}
                        name="checker"
                        render={({ field }) => (
                            <PaymentEligibilityCheckerSelector
                                value={field.value}
                                onChange={field.onChange}
                                onValidityChange={setCheckerArgsValid}
                            />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="payment-handler" title={<Trans>Calculator</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="handler"
                        render={({ field }) => (
                            <PaymentHandlerSelector
                                value={field.value}
                                onChange={field.onChange}
                                onValidityChange={setHandlerArgsValid}
                            />
                        )}
                    />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
