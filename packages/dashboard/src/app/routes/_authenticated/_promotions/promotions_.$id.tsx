import { DateTimeInput } from '@/vdb/components/data-input/datetime-input.js';
import { NumberInput } from '@/vdb/components/data-input/number-input.js';
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
import { PromotionActionsSelector } from './components/promotion-actions-selector.js';
import { PromotionConditionsSelector } from './components/promotion-conditions-selector.js';
import {
    createPromotionDocument,
    promotionDetailDocument,
    updatePromotionDocument,
} from './promotions.graphql.js';

const pageId = 'promotion-detail';

export const Route = createFileRoute('/_authenticated/_promotions/promotions_/$id')({
    component: PromotionDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: promotionDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/promotions', label: <Trans>Promotions</Trans> },
                isNew ? <Trans>New promotion</Trans> : entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function PromotionDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: promotionDetailDocument,
        createDocument: createPromotionDocument,
        transformCreateInput: values => {
            return {
                ...values,
                startsAt: values.startsAt || undefined,
                endsAt: values.endsAt || undefined,
                conditions: values.conditions.filter(c => c.code !== ''),
                actions: values.actions.filter(a => a.code !== ''),
            };
        },
        updateDocument: updatePromotionDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                description: entity.description,
                enabled: entity.enabled,
                couponCode: entity.couponCode,
                perCustomerUsageLimit: entity.perCustomerUsageLimit,
                usageLimit: entity.usageLimit,
                startsAt: entity.startsAt,
                endsAt: entity.endsAt,
                conditions: entity.conditions.map(x => ({
                    code: x.code,
                    arguments: x.args.map(a => ({ name: a.name, value: a.value })),
                })),
                actions: entity.actions.map(x => ({
                    code: x.code,
                    arguments: x.args.map(a => ({ name: a.name, value: a.value })),
                })),
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
            if (data.__typename === 'Promotion') {
                toast.success(
                    creatingNewEntity ? t`Successfully created promotion` : t`Successfully updated promotion`,
                );
                resetForm();
                if (creatingNewEntity) {
                    await navigate({ to: `../$id`, params: { id: data.id } });
                }
            } else {
                toast.error(
                    creatingNewEntity ? t`Failed to create promotion` : t`Failed to update promotion`,
                    {
                        description: data.message,
                    },
                );
            }
        },
        onError: err => {
            toast.error(creatingNewEntity ? t`Failed to create promotion` : t`Failed to update promotion`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    const [conditionsArgsValid, setConditionsArgsValid] = useState(true);
    const [actionsArgsValid, setActionsArgsValid] = useState(true);

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New promotion</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdatePromotion']}>
                    <Button
                        type="submit"
                        disabled={
                            !form.formState.isDirty ||
                            !form.formState.isValid ||
                            isPending ||
                            !conditionsArgsValid ||
                            !actionsArgsValid
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
                        description={<Trans>When enabled, a promotion is available in the shop</Trans>}
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
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
                        <div></div>
                    </DetailFormGrid>
                    <div className="mb-4">
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="description"
                            label={<Trans>Description</Trans>}
                            render={({ field }) => <RichTextInput {...field} />}
                        />
                    </div>
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="startsAt"
                            label={<Trans>Starts at</Trans>}
                            render={({ field }) => (
                                <DateTimeInput
                                    {...field}
                                    value={field.value}
                                    onChange={value => field.onChange(value)}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="endsAt"
                            label={<Trans>Ends at</Trans>}
                            render={({ field }) => (
                                <DateTimeInput
                                    {...field}
                                    value={field.value}
                                    onChange={value => field.onChange(value)}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="couponCode"
                            label={<Trans>Coupon code</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="perCustomerUsageLimit"
                            label={<Trans>Per customer usage limit</Trans>}
                            render={({ field }) => (
                                <NumberInput {...field} value={field.value ?? ''} min={0} max={1000} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="usageLimit"
                            label={<Trans>Usage limit</Trans>}
                            render={({ field }) => (
                                <NumberInput {...field} value={field.value ?? ''} min={0} max={1000} />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Promotion" control={form.control} />
                <PageBlock column="main" blockId="conditions" title={<Trans>Conditions</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="conditions"
                        render={({ field }) => (
                            <PromotionConditionsSelector
                                value={field.value ?? []}
                                onChange={field.onChange}
                                onValidityChange={setConditionsArgsValid}
                            />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="actions" title={<Trans>Actions</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="actions"
                        render={({ field }) => (
                            <PromotionActionsSelector
                                value={field.value ?? []}
                                onChange={field.onChange}
                                onValidityChange={setActionsArgsValid}
                            />
                        )}
                    />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
