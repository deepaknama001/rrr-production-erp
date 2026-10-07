import {json,readJson,errorResponse} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';
import {getUiPreferenceD1,saveUiPreferenceD1} from '../_lib/d1.js';

export async function onRequestGet(context){
  try{
    if(!context.env.DB)return json({error:'D1 database binding is unavailable.'},503);
    const actor=await requireAuth(context);
    const page=new URL(context.request.url).searchParams.get('page')||'';
    if(!page)return json({error:'Page key required.'},400);
    return json(await getUiPreferenceD1(context.env,actor.uid,page));
  }catch(e){return errorResponse(e)}
}
export async function onRequestPost(context){
  try{
    if(!context.env.DB)return json({error:'D1 database binding is unavailable.'},503);
    const actor=await requireAuth(context),body=await readJson(context.request);
    const page=String(body.page||'');if(!page)return json({error:'Page key required.'},400);
    return json(await saveUiPreferenceD1(context.env,actor.uid,page,body.prefs||{}));
  }catch(e){return errorResponse(e)}
}
