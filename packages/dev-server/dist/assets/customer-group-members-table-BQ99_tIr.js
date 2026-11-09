import{r as a,E as h,o as y,p as j,t as o,e8 as A,a as N,e9 as L,j as s,dE as P,B as T,s as $,e5 as D,T as E,g as F}from"./index-BEWB-Tpc.js";import{C as G}from"./customer-selector-BwblO224.js";const n=F(`
    query CustomerGroupMemberList($id: ID!, $options: CustomerListOptions) {
        customerGroup(id: $id) {
            customers(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    firstName
                    lastName
                    emailAddress
                }
                totalItems
            }
        }
    }
`);function q({customerGroupId:r,canAddCustomers:u=!0}){const[d,l]=a.useState([]),[m,c]=a.useState(1),[p,g]=a.useState(10),[C,f]=a.useState([]),{_:i}=h(),S=y(),{mutate:x}=j({mutationFn:N.mutate(L),onSuccess:()=>{o.success(i({id:"y3tQ/s"})),S.invalidateQueries({queryKey:[A,n]})},onError:()=>{o.error(i({id:"ZlA28n"}))}});return s.jsxs("div",{children:[s.jsx(P,{listQuery:D(n),transformVariables:e=>({...e,id:r}),page:m,itemsPerPage:p,sorting:d,columnFilters:C,onPageChange:(e,t,b)=>{c(t),g(b)},onSortChange:(e,t)=>{l(t)},onFilterChange:(e,t)=>{f(t)},onSearchTermChange:e=>({lastName:{contains:e},emailAddress:{contains:e}}),additionalColumns:{name:{header:"Name",cell:({row:e})=>{const t=`${e.original.firstName} ${e.original.lastName}`;return s.jsx(T,{render:s.jsx($,{to:"/customers/$id",params:{id:e.original.id}}),variant:"ghost",children:t})}}},defaultColumnOrder:["name","emailAddress"],defaultVisibility:{id:!1,createdAt:!1,updatedAt:!1,firstName:!1,lastName:!1}}),u&&s.jsx(G,{onSelect:e=>{x({customerId:e.id,groupId:r})},label:s.jsx(E,{id:"IswRMs"})})]})}export{q as C};
