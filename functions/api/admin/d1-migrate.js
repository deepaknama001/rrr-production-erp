import {json,readJson,errorResponse} from '../../_lib/common.js';
import {callGas} from '../../_lib/gas.js';
import {requireAuth} from '../../_lib/auth.js';
import {d1Status,migrateSnapshotToD1,reconcileD1,activateD1,deactivateD1} from '../../_lib/d1.js';

export async function onRequestGet(context){
  try{
    await requireAuth(context,true);
    const status=await d1Status(context.env);
    if(!status.bound)return json({bound:false,ready:false});
    const rec=await reconcileD1(context.env);
    return json({bound:true,ready:!!rec.active,...rec});
  }catch(e){return errorResponse(e)}
}
export async function onRequestPost(context){
  try{
    const actor=await requireAuth(context,true),body=await readJson(context.request),action=String(body.action||'status');
    if(action==='load'){
      if(!context.env.DB)throw Object.assign(new Error('D1 binding DB is missing.'),{status:500});
      const snapshot=await callGas(context.env,'export_d1_snapshot',{actorUserId:actor.uid});
      const loaded=await migrateSnapshotToD1(context.env,snapshot);
      const reconciliation=await reconcileD1(context.env);
      return json({action:'load',loaded,reconciliation});
    }
    if(action==='activate')return json({action:'activate',reconciliation:await activateD1(context.env)});
    if(action==='deactivate')return json({action:'deactivate',reconciliation:await deactivateD1(context.env)});
    return json({action:'status',reconciliation:await reconcileD1(context.env)});
  }catch(e){return errorResponse(e)}
}
