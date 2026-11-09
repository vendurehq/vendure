import{r as a,F as h,o as y,p as j,t as o,e5 as A,a as N,e6 as L,j as s,dB as P,B as T,s as $,e2 as F,T as D,g as G}from"./index-C9uJSeZM.js";import{C as M}from"./customer-selector-B37lHDJN.js";const n=G(`
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
`);function v({customerGroupId:r,canAddCustomers:u=!0}){const[d,l]=a.useState([]),[m,c]=a.useState(1),[p,g]=a.useState(10),[C,f]=a.useState([]),{_:i}=h(),S=y(),{mutate:x}=j({mutationFn:N.mutate(L),onSuccess:()=>{o.success(i({id:"y3tQ/s"})),S.invalidateQueries({queryKey:[A,n]})},onError:()=>{o.error(i({id:"ZlA28n"}))}});return s.jsxs("div",{children:[s.jsx(P,{listQuery:F(n),transformVariables:e=>({...e,id:r}),page:m,itemsPerPage:p,sorting:d,columnFilters:C,onPageChange:(e,t,b)=>{c(t),g(b)},onSortChange:(e,t)=>{l(t)},onFilterChange:(e,t)=>{f(t)},onSearchTermChange:e=>({lastName:{contains:e},emailAddress:{contains:e}}),additionalColumns:{name:{header:"Name",cell:({row:e})=>{const t=`${e.original.firstName} ${e.original.lastName}`;return s.jsx(T,{render:s.jsx($,{to:"/customers/$id",params:{id:e.original.id}}),variant:"ghost",children:t})}}},defaultColumnOrder:["name","emailAddress"],defaultVisibility:{id:!1,createdAt:!1,updatedAt:!1,firstName:!1,lastName:!1}}),u&&s.jsx(M,{onSelect:e=>{x({customerId:e.id,groupId:r})},label:s.jsx(D,{id:"IswRMs"})})]})}export{v as C};
