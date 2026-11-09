import{j as t,e7 as j,r as i,aL as D,dB as C,e2 as y,B as P,q as k,T as B,s as L,g as T}from"./index-C9uJSeZM.js";import{D as q}from"./detail-page-button-m2l_1btg.js";import{D as A}from"./delete-bulk-action-CrLI99Yc.js";const $=({selection:a,table:n})=>t.jsx(A,{mutationDocument:j,entityName:"facets",requiredPermissions:["DeleteCatalog","DeleteFacet"],selection:a,table:n}),r="facet-values-table",v=T(`
    query FacetValueList($options: FacetValueListOptions) {
        facetValues(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                code
                customFields
            }
            totalItems
        }
    }
`);function N({facetId:a,registerRefresher:n}){const[m,d]=i.useState([]),[u,g]=i.useState(1),[o,f]=i.useState(10),{setTableSettings:c,settings:p}=D(),b=i.useRef(()=>{}),l=p.tableSettings?.[r],F={name:!0,code:!0},V=l?.columnVisibility??F,h=l?.columnOrder??[],x=l?.columnFilters;return t.jsxs(t.Fragment,{children:[t.jsx(C,{listQuery:y(v),page:u,itemsPerPage:o,sorting:m,columnFilters:x,defaultColumnOrder:h,defaultVisibility:V,onPageChange:(e,s,S)=>{f(S),g(s)},onSortChange:(e,s)=>{d(s)},onFilterChange:(e,s)=>{c(r,"columnFilters",s)},onColumnVisibilityChange:(e,s)=>{c(r,"columnVisibility",s)},registerRefresher:e=>{b.current=e,n?.(e)},transformVariables:e=>({options:{filter:{...e.options?.filter??{},facetId:{eq:a}},sort:e.options?.sort,take:o,skip:(u-1)*o}}),onSearchTermChange:e=>({name:{contains:e}}),customizeColumns:{name:{header:"Name",cell:({row:e})=>t.jsx(q,{id:e.original.id,label:e.original.name,href:`/facets/${a}/values/${e.original.id}`})}},bulkActions:[{component:$}]}),t.jsx("div",{className:"mt-4",children:t.jsxs(P,{render:t.jsx(L,{to:`/facets/${a}/values/new`}),variant:"outline",children:[t.jsx(k,{}),t.jsx(B,{id:"GZg2Zw"})]})})]})}export{N as F};
