import {json,errorResponse} from '../_lib/common.js';
import {d1Status} from '../_lib/d1.js';
export async function onRequestGet(context){
  try{
    const status=await d1Status(context.env);
    if(!status.bound)return json({ok:false,backend:'D1',error:'D1 database binding is unavailable.',d1:status},503);
    return json({ok:status.ready,backend:'D1',d1:status},status.ready?200:503);
  }catch(e){return errorResponse(e)}
}