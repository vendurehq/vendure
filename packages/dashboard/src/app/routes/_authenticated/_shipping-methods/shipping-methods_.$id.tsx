import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Textarea } from '@/vdb/components/ui/textarea.js';
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
import { FulfillmentHandlerSelector } from './components/fulfillment-handler-selector.js';
import { ShippingCalculatorSelector } from './components/shipping-calculator-selector.js';
import { ShippingEligibilityCheckerSelector } from './components/shipping-eligibility-checker-selector.js';
import { TestSingleShippingMethodSheet } from './components/test-single-shipping-method-sheet.js';
import {
    createShippingMethodDocument,
    shippingMethodDetailDocument,
    updateShippingMethodDocument,
} from './shipping-methods.graphql.js';

const pageId = 'shipping-method-detail';

export const Route = createFileRoute('/_authenticated/_shipping-methods/shipping-methods_/$id')({
    component: ShippingMethodDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: shippingMethodDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/shipping-methods', label: <Trans>Shipping Methods</Trans> },
                isNew ? <Trans>New shipping method</Trans> : entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function ShippingMethodDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: shippingMethodDetailDocument,
        createDocument: createShippingMethodDocument,
        updateDocument: updateShippingMethodDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                code: entity.code,
                description: entity.description,
                fulfillmentHandler: entity.fulfillmentHandlerCode,
                checker: entity.checker && {
                    code: entity.checker?.code,
                    arguments: entity.checker?.args,
                },
                calculator: entity.calculator && {
                    code: entity.calculator?.code,
                    arguments: entity.calculator?.args,
                },
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
        params: { id: params.id },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created shipping method`
                    : t`Successfully updated shipping method`,
            );
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity ? t`Failed to create shipping method` : t`Failed to update shipping method`,
                {
                    description: err instanceof Error ? err.message : 'Unknown error',
                },
            );
        },
    });

    const checker = form.watch('checker');
    const calculator = form.watch('calculator');

    const [checkerArgsValid, setCheckerArgsValid] = useState(true);
    const [calculatorArgsValid, setCalculatorArgsValid] = useState(true);

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? <Trans>New shipping method</Trans> : (entity?.name ?? '')}
            </PageTitle>
            <PageActionBar>
                {!creatingNewEntity && entity && (
                    <ActionBarItem itemId="test-shipping-button">
                        <TestSingleShippingMethodSheet checker={checker} calculator={calculator} />
                    </ActionBarItem>
                )}
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateShippingMethod']}>
                    <Button
                        type="submit"
                        disabled={
                            !form.formState.isDirty ||
                            !form.formState.isValid ||
                            isPending ||
                            !checker?.code ||
                            !calculator?.code ||
                            !checkerArgsValid ||
                            !calculatorArgsValid
                        }
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
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Code</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                    <div className="mb-6">
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="description"
                            label={<Trans>Description</Trans>}
                            render={({ field }) => <Textarea {...field} />}
                        />
                    </div>
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="fulfillmentHandler"
                            label={<Trans>Fulfillment handler</Trans>}
                            render={({ field }) => (
                                <FulfillmentHandlerSelector value={field.value} onChange={field.onChange} />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="ShippingMethod" control={form.control} />
                <PageBlock column="main" blockId="conditions" title={<Trans>Conditions</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="checker"
                        render={({ field }) => (
                            <ShippingEligibilityCheckerSelector
                                value={field.value}
                                onChange={field.onChange}
                                onValidityChange={setCheckerArgsValid}
                            />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="calculator" title={<Trans>Calculator</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="calculator"
                        render={({ field }) => (
                            <ShippingCalculatorSelector
                                value={field.value}
                                onChange={field.onChange}
                                onValidityChange={setCalculatorArgsValid}
                            />
                        )}
                    />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
