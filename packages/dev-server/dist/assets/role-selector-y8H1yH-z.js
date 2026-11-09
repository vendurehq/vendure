import{E as l,u as r,j as p,dh as u,g as d,a as m}from"./index-BEWB-Tpc.js";const h=d(`
    query Roles($options: RoleListOptions) {
        roles(options: $options) {
            items {
                id
                code
                description
            }
        }
    }
`);function q(o){const{value:t,onChange:i,multiple:a}=o,{_:s}=l(),{data:n}=r({queryKey:["roles"],queryFn:()=>m.query(h,{options:{take:100}}),select:e=>e.roles.items}),c=(n??[]).map(e=>({value:e.id,label:e.code,display:e.description?e.description:e.code}));return p.jsx(u,{value:t,onChange:i,multiple:a,items:c,placeholder:s({id:"h4pFju"}),searchPlaceholder:s({id:"jxxbqF"})})}export{q as R};
