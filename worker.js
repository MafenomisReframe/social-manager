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
      if(url.pathname==="/api/session" && request.method==="GET"){
        const user=await env.DB.prepare("SELECT id,email,display_name FROM users WHERE email = ?").bind(auth.email).first();
        if(!user)return json({error:"account_not_provisioned"},403);
        const memberships=await env.DB.prepare("SELECT tenant_id,role FROM memberships WHERE user_id = ?").bind(user.id).all();
        return json({user,memberships:memberships.results});
      }
      return json({error:"not_found"},404);
    }
    return env.ASSETS.fetch(request);
  }
};
