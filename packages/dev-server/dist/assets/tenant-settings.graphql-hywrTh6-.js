import{j as t,b0 as o,bS as r,gW as p,dp as g}from"./index-BEWB-Tpc.js";function h(l,i){return i.split(".").reduce((c,a)=>c?.[a],l)}function m(l,i,c){const a=i.split("."),u={...l??{}};let e=u;for(let n=0;n<a.length-1;n++)e[a[n]]=e[a[n]]??{},e=e[a[n]];return e[a[a.length-1]]=c,u}function j({fields:l,values:i,onChange:c}){const a=(e,n)=>c(m(i,e,n)),u=e=>{const n=e.name,d=h(i,e.name);switch(e.type){case"boolean":return t.jsxs("div",{className:"flex items-center gap-2 py-1",children:[t.jsx(g,{id:n,checked:!!d,onCheckedChange:s=>a(e.name,!!s)}),t.jsx(o,{htmlFor:n,children:e.label})]},n);case"textarea":return t.jsxs("div",{className:"grid gap-1 py-1",children:[t.jsx(o,{htmlFor:n,children:e.label}),t.jsx(p,{id:n,value:d??"",onChange:s=>a(e.name,s.target.value)})]},n);case"stringList":return t.jsxs("div",{className:"grid gap-1 py-1",children:[t.jsx(o,{htmlFor:n,children:e.label}),t.jsx(p,{id:n,value:(d??[]).join(`
`),onChange:s=>a(e.name,s.target.value.split(`
`).filter(Boolean))}),t.jsx("p",{className:"text-xs text-muted-foreground",children:"每行一项"})]},n);case"password":return t.jsxs("div",{className:"grid gap-1 py-1",children:[t.jsx(o,{htmlFor:n,children:e.label}),t.jsx(r,{id:n,type:"password",value:d??"",onChange:s=>a(e.name,s.target.value)})]},n);default:return t.jsxs("div",{className:"grid gap-1 py-1",children:[t.jsx(o,{htmlFor:n,children:e.label}),t.jsx(r,{id:n,value:d??"",onChange:s=>a(e.name,s.target.value)})]},n)}};return t.jsx("div",{children:l.map(e=>"group"in e?t.jsxs("fieldset",{className:"mb-4",children:[t.jsx("legend",{className:"font-semibold",children:e.group}),e.fields.map(u)]},e.group):u(e))})}const v=`
    query GetTenantSettings($channelId: ID!) {
        tenantSettings(channelId: $channelId) {
            channelId
            basic
            auth
            pay
            map
            serviceNotify
            multiLanguage
            canEdit
        }
    }
`,T=`
    mutation UpdateTenantBasic($input: TenantSectionPatchInput!) {
        updateTenantBasic(input: $input) {
            channelId
            basic
        }
    }
`,b=`
    mutation UpdateTenantMultiLanguage($input: TenantSectionPatchInput!) {
        updateTenantMultiLanguage(input: $input) {
            channelId
            multiLanguage
        }
    }
`,I=`
    mutation UpdateTenantServiceNotify($input: TenantSectionPatchInput!) {
        updateTenantServiceNotify(input: $input) {
            channelId
            serviceNotify
        }
    }
`,N=`
    mutation UpdateTenantConfig($input: UpdateTenantConfigInput!) {
        updateTenantConfig(input: $input) {
            channelId
            auth
            pay
            map
            canEdit
        }
    }
`;export{j as S,b as a,N as b,I as c,h as d,v as t,T as u};
