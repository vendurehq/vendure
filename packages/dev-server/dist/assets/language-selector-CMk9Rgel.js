import{F as c,r as n,u as b,E as m,j as L,de as p,g as d,a as f}from"./index-BcOoJppr.js";function v(e){const{formatLanguageName:l}=c();return n.useMemo(()=>(e??[]).map(a=>({code:a,label:l(a)})).sort((a,s)=>a.label.localeCompare(s.label)),[e,l])}const x=d(`
    query AvailableGlobalLanguages {
        globalSettings {
            availableLanguages
        }
    }
`);function S(e){const{data:l}=b({queryKey:["availableGlobalLanguages"],queryFn:()=>f.query(x),staleTime:3e5}),{value:a,onChange:s,multiple:r,availableLanguageCodes:g}=e,{_:o}=m(),t=v(g??l?.globalSettings.availableLanguages??void 0),i=n.useMemo(()=>t.map(u=>({value:u.code,label:u.label})),[t]);return L.jsx(p,{value:a,onChange:s,multiple:r,items:i,placeholder:o({id:"ffxVQ8"}),searchPlaceholder:o({id:"StoBff"})})}export{S as L,v as u};
