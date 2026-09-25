/**
 * Test page for `setValuesForCreate`. The `$preset` route param stands in for a parent ID.
 */
import {
    AnyRoute,
    Button,
    CustomFieldsPageBlock,
    DetailFormGrid,
    graphql,
    Input,
    Link,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    TranslatableFormFieldWrapper,
    useDetailPage,
    useNavigate,
} from '@vendure/dashboard';

const productDocument = graphql(`
    query StartingValuesTestProduct($id: ID!) {
        product(id: $id) {
            id
            name
            enabled
            translations {
                id
                languageCode
                name
                slug
                description
            }
        }
    }
`);

const createProductDocument = graphql(`
    mutation StartingValuesTestCreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`);

const updateProductDocument = graphql(`
    mutation StartingValuesTestUpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`);

export function StartingValuesTestPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === 'new';

    const { form, submitHandler, entity, isPending } = useDetailPage({
        pageId: 'starting-values-test',
        entityName: 'Product',
        queryDocument: productDocument,
        createDocument: createProductDocument,
        updateDocument: updateProductDocument,
        params: { id: params.id },
        setValuesForUpdate: product => ({
            id: product.id,
            enabled: product.enabled,
            translations: product.translations.map(translation => ({
                id: translation.id,
                languageCode: translation.languageCode,
                name: translation.name,
                slug: translation.slug,
                description: translation.description,
            })),
            customFields: (product as any).customFields,
        }),
        setValuesForCreate: () => ({
            translations: [
                {
                    languageCode: 'en',
                    name: `Prefilled ${params.preset}`,
                    slug: `prefilled-${params.preset}`,
                },
            ],
            customFields: {
                infoUrl: `https://example.com/${params.preset}`,
                // Changes on every call, to check that the form is not reset on each render.
                additionalInfo: `Opened at ${Date.now()}`,
            },
        }),
        onSuccess: async data => {
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
    });

    return (
        <Page pageId="starting-values-test" form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>Starting Values Test</PageTitle>
            <PageActionBar>
                <Button
                    type="submit"
                    disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                >
                    {creatingNewEntity ? 'Create' : 'Update'}
                </Button>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <div className="flex gap-4">
                        <Link to="/starting-values-test/$preset/$id" params={{ preset: 'other', id: 'new' }}>
                            Open create page with preset "other"
                        </Link>
                        <Link to="/form-inputs-test">Leave page</Link>
                    </div>
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label="Name"
                            render={({ field }) => <Input {...field} />}
                        />
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="slug"
                            label="Slug"
                            render={({ field }) => <Input {...field} />}
                        />
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="description"
                            label="Description"
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Product" control={form.control} />
            </PageLayout>
        </Page>
    );
}
