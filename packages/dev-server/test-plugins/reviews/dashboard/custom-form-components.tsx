import {
    DashboardFormComponent,
    MultiRelationInput,
    RelationSelectorConfig,
    ResultOf,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SingleRelationInput,
    Textarea,
} from '@vendure/dashboard';
import { graphql } from '../../../graphql/graphql';

export const TextareaCustomField: DashboardFormComponent = props => {
    return <Textarea {...props} rows={4} />;
};

export const ResponseDisplay: DashboardFormComponent = ({ value }) => {
    return <div className="font-mono">{value}</div>;
};

export const BodyInputComponent: DashboardFormComponent = props => {
    return <Textarea {...props} rows={4} />;
};

const reviewFragment = graphql(`
    fragment Review on ProductReview {
        id
        summary
    }
`);

const reviewListQuery = graphql(
    `
        query GetReviewList($options: ProductReviewListOptions) {
            productReviews(options: $options) {
                items {
                    ...Review
                }
                totalItems
            }
        }
    `,
    [reviewFragment],
);

export const ReviewSingleSelect: DashboardFormComponent = props => {
    const config: RelationSelectorConfig<ResultOf<typeof reviewFragment>> = {
        listQuery: reviewListQuery,
        labelKey: 'summary',
        idKey: 'id',
    };

    return <SingleRelationInput {...props} config={config}></SingleRelationInput>;
};

export const ReviewMultiSelect: DashboardFormComponent = props => {
    const config: RelationSelectorConfig<ResultOf<typeof reviewFragment>> = {
        listQuery: reviewListQuery,
        labelKey: 'summary',
        idKey: 'id',
    };

    return <MultiRelationInput config={config} {...props}></MultiRelationInput>;
};

export const ReviewStateSelect: DashboardFormComponent = props => {
    return (
        <Select value={props.value} onValueChange={props.onChange} key={props.value}>
            <SelectTrigger>
                <SelectValue placeholder="Select state..."></SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
        </Select>
    );
};
