import{r as n,j as s,dB as p,B as C,s as h,e2 as S,g as x}from"./index-DS-sPk4K.js";const P=x(`
    query CollectionContentsList($collectionId: ID!, $options: ProductVariantListOptions) {
        collection(id: $collectionId) {
            id
            productVariants(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    name
                    sku
                }
                totalItems
            }
        }
    }
`);function $({collectionId:a}){const[o,i]=n.useState([]),[r,l]=n.useState(1),[c,u]=n.useState(10),[d,g]=n.useState([]);return s.jsx(p,{listQuery:S(P),transformVariables:t=>({...t,collectionId:a}),customizeColumns:{name:{header:"Variant name",cell:({row:t})=>s.jsxs(C,{render:s.jsx(h,{to:`../../product-variants/${t.original.id}`}),variant:"ghost",children:[t.original.name," "]})}},page:r,itemsPerPage:c,sorting:o,columnFilters:d,onPageChange:(t,e,m)=>{l(e),u(m)},onSortChange:(t,e)=>{i(e)},onFilterChange:(t,e)=>{g(e)},onSearchTermChange:t=>({name:{contains:t}})})}export{$ as C};
