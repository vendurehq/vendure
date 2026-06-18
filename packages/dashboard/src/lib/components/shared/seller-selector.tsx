import { RelationSelector } from '@/vdb/components/data-input/relation-selector.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';

const sellerListDocument = graphql(`
    query SellerList($options: SellerListOptions) {
        sellers(options: $options) {
            items {
                id
                name
            }
            totalItems
        }
    }
`);

export interface Seller {
    id: string;
    name: string;
}

export interface SellerSelectorProps {
    value?: string | null;
    onChange: (value: string) => void;
    label?: string | React.ReactNode;
    readOnly?: boolean;
}

export function SellerSelector(props: SellerSelectorProps) {
    const { t } = useLingui();
    return (
        <RelationSelector<Seller>
            config={{
                listQuery: sellerListDocument,
                idKey: 'id',
                labelKey: 'name',
                placeholder: t`Search sellers...`,
            }}
            selectorLabel={props.label ?? <Trans>Select seller</Trans>}
            value={props.value ?? undefined}
            onChange={value => {
                if (typeof value === 'string') {
                    props.onChange(value);
                }
            }}
            disabled={props.readOnly}
        />
    );
}
