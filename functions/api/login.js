import {json,readJson,errorResponse} from '../_lib/common.js';
import {issueToken} from '../_lib/auth.js';
import {loginD1} from '../_lib/d1.js';
export async function onRequestPost(context){
  try{
    if(!context.env.DB) return json({error:'D1 database binding is unavailable.'},503);
    const b=await readJson(context.request),userId=String(b.userId||'').trim().toUpperCase(),pin=String(b.pin||'');
    if(!userId||!pin)return json({error:'Employee ID and PIN required.'},400);
    const r=await loginD1(context.env,{userId,pin});
    const token=await issueToken(r.user,context.env.SESSION_SECRET);
    return json({token,user:r.user,kpis:r.kpis||null,backend:'D1'});
  }catch(e){return errorResponse(e)}
}