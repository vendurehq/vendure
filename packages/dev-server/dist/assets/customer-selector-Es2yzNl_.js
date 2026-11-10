import{r,cp as x,u as p,j as e,aM as h,aN as j,q as f,T as n,B as N,aP as C,df as g,dg as y,dh as S,di as v,dj as O,g as T,a as b}from"./index-BcOoJppr.js";const q=T(`
    query GetCustomers($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                firstName
                lastName
                emailAddress
            }
            totalItems
        }
    }
`);function A(t){const[i,o]=r.useState(!1),[l,m]=r.useState(""),a=x(l,300),{data:d,isLoading:c}=p({queryKey:["customers",a],queryFn:()=>b.query(q,{options:{sort:{lastName:"ASC"},filter:a?{firstName:{contains:a},lastName:{contains:a},emailAddress:{contains:a}}:void 0,filterOperator:a?"OR":void 0}}),staleTime:1e3*60}),u=s=>{m(s)};return e.jsxs(h,{open:i,onOpenChange:o,children:[e.jsxs(j,{render:e.jsx(N,{variant:"outline",size:"sm",type:"button",disabled:t.readOnly,className:"gap-2"}),children:[e.jsx(f,{className:"h-4 w-4"}),t.label??e.jsx(n,{id:"C0uyNO"})]}),e.jsx(C,{className:"p-0 w-[350px]",align:"start",children:e.jsxs(g,{shouldFilter:!1,children:[e.jsx(y,{placeholder:"Search customers...",onValueChange:u,className:"h-10 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"}),e.jsxs(S,{children:[e.jsx(v,{children:c?e.jsx(n,{id:"Z3FXyt"}):e.jsx(n,{id:"BLXWJv"})}),d?.customers.items.map(s=>e.jsxs(O,{onSelect:()=>{t.onSelect(s),o(!1)},className:"flex flex-col items-start",children:[e.jsxs("div",{className:"font-medium",children:[s.firstName," ",s.lastName]}),e.jsx("div",{className:"text-sm text-muted-foreground",children:s.emailAddress})]},s.id))]})]})})]})}export{A as C};
