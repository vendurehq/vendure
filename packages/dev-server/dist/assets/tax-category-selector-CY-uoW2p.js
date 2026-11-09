import{u as l,j as s,dy as c,b1 as d,b2 as m,b3 as u,T as x,b4 as g,dz as p,b5 as j,g as h,a as C}from"./index-BEWB-Tpc.js";const S=h(`
    query TaxCategories($options: TaxCategoryListOptions) {
        taxCategories(options: $options) {
            items {
                id
                name
                isDefault
            }
        }
    }
`);function y({value:t,onChange:i}){const{data:a,isLoading:n,isPending:r,status:T}=l({queryKey:["taxCategories"],staleTime:3e5,queryFn:()=>C.query(S,{options:{take:100}})});return n||r?s.jsx(c,{className:"h-10 w-full"}):s.jsxs(d,{items:a?Object.fromEntries(a.taxCategories.items.map(e=>[e.id,e.name])):{},value:t??"",onValueChange:e=>e&&i(e),children:[s.jsx(m,{children:s.jsx(u,{placeholder:s.jsx(x,{id:"LWiFS0"}),children:e=>a?.taxCategories.items.find(o=>o.id===e)?.name})}),s.jsx(g,{children:a&&s.jsx(p,{children:a?.taxCategories.items.map(e=>s.jsx(j,{value:e.id,children:e.name},e.id))})})]})}export{y as T};
