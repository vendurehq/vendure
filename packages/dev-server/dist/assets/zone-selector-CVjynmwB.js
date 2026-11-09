import{u as l,j as s,dy as c,b1 as d,b2 as m,b3 as u,T as p,b4 as h,dz as j,b5 as x,g as S,a as g}from"./index-BEWB-Tpc.js";const y=S(`
    query Zones($options: ZoneListOptions) {
        zones(options: $options) {
            items {
                id
                name
            }
        }
    }
`);function f({value:t,onChange:i}){const{data:n,isLoading:a,isPending:o}=l({queryKey:["zones"],staleTime:3e5,queryFn:()=>g.query(y,{options:{take:100}})});return a||o?s.jsx(c,{className:"h-10 w-full"}):s.jsxs(d,{items:n?Object.fromEntries(n.zones.items.map(e=>[e.id,e.name])):{},value:t??"",onValueChange:e=>e&&i(e),children:[s.jsx(m,{children:s.jsx(u,{placeholder:s.jsx(p,{id:"p3M+0h"}),children:e=>n?.zones.items.find(r=>r.id===e)?.name})}),s.jsx(h,{children:n&&s.jsx(j,{children:n?.zones.items.map(e=>s.jsx(x,{value:e.id,children:e.name},e.id))})})]})}export{f as Z};
