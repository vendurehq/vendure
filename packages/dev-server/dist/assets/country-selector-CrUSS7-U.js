import{r,u,j as e,aL as x,aM as h,q as p,T as n,B as j,aO as f,di as C,S as g,dj as y,dk as S,dl as v,dm as N,g as q,a as O}from"./index-BEWB-Tpc.js";const b=q(`
    query CountryList($options: CountryListOptions) {
        countries(options: $options) {
            items {
                id
                name
                code
            }
            totalItems
        }
    }
`);function T(t){const[i,o]=r.useState(!1),[a,l]=r.useState(""),{data:d,isLoading:c}=u({queryKey:["countries",a],queryFn:()=>O.query(b,{options:{sort:{name:"ASC"},filter:a?{name:{contains:a},code:{contains:a}}:void 0,filterOperator:a?"OR":void 0}}),staleTime:1e3*60*60}),m=s=>{l(s)};return e.jsxs(x,{open:i,onOpenChange:o,children:[e.jsxs(h,{render:e.jsx(j,{variant:"outline",size:"sm",type:"button",disabled:t.readOnly,className:"gap-2"}),children:[e.jsx(p,{className:"h-4 w-4"}),t.label??e.jsx(n,{id:"hJmVtD"})]}),e.jsx(f,{className:"p-0 w-[350px]",align:"start",children:e.jsxs(C,{shouldFilter:!1,children:[e.jsxs("div",{className:"flex items-center border-b px-3",children:[e.jsx(g,{className:"mr-2 h-4 w-4 shrink-0 opacity-50"}),e.jsx(y,{placeholder:"Search countries...",onValueChange:m,className:"h-10 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"})]}),e.jsxs(S,{children:[e.jsx(v,{children:c?e.jsx(n,{id:"Z3FXyt"}):e.jsx(n,{id:"Bj9qwi"})}),d?.countries.items.map(s=>e.jsxs(N,{onSelect:()=>{t.onSelect(s),o(!1)},className:"flex flex-col items-start",children:[e.jsx("div",{className:"font-medium",children:s.name}),e.jsx("div",{className:"text-sm text-muted-foreground",children:s.code})]},s.id))]})]})})]})}export{T as C};
