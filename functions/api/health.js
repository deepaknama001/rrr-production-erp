import {json,errorResponse} from '../_lib/common.js';import {callGas} from '../_lib/gas.js';
export async function onRequestGet(context){try{const r=await callGas(context.env,'health',{});return json(r)}catch(e){return errorResponse(e)}}
