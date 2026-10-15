import { jwtVerify, createRemoteJWKSet } from "jose";

// All customer data endpoints fail closed until Access JWT validation is configured.
// Never trust user-supplied email, tenant ID, or unsigned Access headers.
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const TEAM_DOMAIN="https://nameless-cherry-6ec3.cloudflareaccess.com";
const jwks=createRemoteJWKSet(new URL(TEAM_DOMAIN+"/cdn-cgi/access/certs"));
async function identity(request,env){
  if(!env.POLICY_AUD) return {error:"auth_not_configured",status:503};
  const token=request.headers.get("Cf-Access-Jwt-Assertion");
  if(!token) return {error:"unauthorized",status:401};
  try{
    const {payload}=await jwtVerify(token,jwks,{issuer:TEAM_DOMAIN,audience:env.POLICY_AUD,algorithms:["RS256"]});
    if(typeof payload.email!=="string" || !payload.email) return {error:"identity_missing",status:403};
    return {email:payload.email.toLowerCase(),sub:String(payload.sub||"")};
  }catch{return {error:"invalid_access_token",status:401};}
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==="/api/health" && request.method==="GET"){
      try{if(!env.DB)return json({status:"unavailable",database:"binding_missing"},503);
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({status:"ok",database:"connected"});
      }catch{return json({status:"unavailable",database:"error"},503);}
    }
    if(url.pathname.startsWith("/api/")){
      const auth=await identity(request,env);
      if(auth.error)return json({error:auth.error},auth.status);
      const user=await env.DB.prepare("SELECT id,email,display_name FROM users WHERE email = ?").bind(auth.email).first();
      if(!user)return json({error:"account_not_provisioned"},403);
      const memberships=(await env.DB.prepare("SELECT tenant_id,role FROM memberships WHERE user_id = ?").bind(user.id).all()).results;
      if(url.pathname==="/api/session" && request.method==="GET")return json({user,memberships});
      // Only the bootstrap owner of the agency workspace may create customer workspaces.
      // Each new customer workspace gets its own tenant ID and membership.
      const agencyOwner=memberships.some(m=>m.tenant_id==="tenant-reframe-001" && m.role==="owner");
      if(url.pathname==="/api/clients" && request.method==="GET"){
        if(!agencyOwner)return json({error:"forbidden"},403);
        const rows=await env.DB.prepare("SELECT t.id,t.name,t.slug,t.created_at FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? ORDER BY t.created_at DESC,t.name").bind(user.id).all();
        return json({clients:rows.results});
      }
      if(url.pathname==="/api/clients" && request.method==="POST"){
        if(!agencyOwner)return json({error:"forbidden"},403);
        const origin=request.headers.get("Origin");
        if(origin && origin!==url.origin)return json({error:"invalid_origin"},403);
        let body;
        try{body=await request.json();}catch{return json({error:"invalid_json"},400);}
        const name=typeof body?.name==="string"?body.name.trim():"";
        if(name.length<2||name.length>120)return json({error:"invalid_name"},400);
        const id=crypto.randomUUID();
        const slug="client-"+id.slice(0,8);
        try{
          await env.DB.batch([
            env.DB.prepare("INSERT INTO tenants(id,name,slug) VALUES(?,?,?)").bind(id,name,slug),
            env.DB.prepare("INSERT INTO memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(id,user.id),
            env.DB.prepare("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),id,user.id,"create","tenant",id)
          ]);
          return json({client:{id,name,slug}},201);
        }catch(e){console.error("Create client failed",e);return json({error:"save_failed"},500);}
      }
      if(url.pathname.startsWith("/api/clients/") && request.method==="GET"){
        if(!agencyOwner)return json({error:"forbidden"},403);
        const id=decodeURIComponent(url.pathname.slice("/api/clients/".length));
        const c=await env.DB.prepare("SELECT id,name,slug,branding_json,created_at FROM tenants WHERE id=? AND EXISTS(SELECT 1 FROM memberships WHERE tenant_id=tenants.id AND user_id=?)").bind(id,user.id).first();
        if(!c)return json({error:"not_found"},404);
        return json({client:{...c,branding:JSON.parse(c.branding_json||"{}")}});
      }
      if(url.pathname.startsWith("/api/clients/") && request.method==="PATCH"){
        if(!agencyOwner)return json({error:"forbidden"},403);
        if(request.headers.get("Origin")!==url.origin)return json({error:"invalid_origin"},403);
        const id=decodeURIComponent(url.pathname.slice("/api/clients/".length));
        const exists=await env.DB.prepare("SELECT id,branding_json FROM tenants WHERE id=? AND EXISTS(SELECT 1 FROM memberships WHERE tenant_id=tenants.id AND user_id=?)").bind(id,user.id).first();
        if(!exists)return json({error:"not_found"},404);
        let body;try{body=await request.json()}catch{return json({error:"invalid_json"},400)}
        const name=typeof body?.name==="string"?body.name.trim():"";
        if(name.length<2||name.length>120)return json({error:"invalid_name"},400);
        const allowed=["sector","website","email","phone","instagram","facebook","linkedin","tiktok","notes"];
        const details={};for(const key of allowed){const val=body?.[key];if(val!==undefined){if(typeof val!=="string"||val.length>2000)return json({error:"invalid_"+key},400);details[key]=val.trim()}}
        const old=JSON.parse(exists.branding_json||"{}");
        await env.DB.prepare("UPDATE tenants SET name=?,branding_json=? WHERE id=?").bind(name,JSON.stringify({...old,...details}),id).run();
        return json({ok:true});
      }
      return json({error:"not_found"},404);
    }
    return env.ASSETS.fetch(request);
  }
};
