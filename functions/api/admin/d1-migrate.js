import {json,errorResponse} from '../../_lib/common.js';
import {requireAuth} from '../../_lib/auth.js';
import {d1Status} from '../../_lib/d1.js';

export async function onRequestGet(context){
  try{
    await requireAuth(context,true);
    const status=await d1Status(context.env);
    return json({bound:status.bound,ready:status.ready,backend:'D1',meta:status.meta||{}});
  }catch(e){return errorResponse(e)}
}

export async function onRequestPost(context){
  try{
    await requireAuth(context,true);
    return json({error:'Google Sheets migration controls are retired. Cloudflare D1 is the permanent live database.'},410);
  }catch(e){return errorResponse(e)}
}
