import {json,errorResponse} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';

const CFG={
  raw:{
    perm:'raw',date:'INWARD_DATE',
    cols:['ROLL_ID','INWARD_ID','INWARD_DATE','SUPPLIER','VENDOR_ROLL_NO','FABRIC','INWARD_MTR','ISSUED_MTR','BALANCE_MTR','STATUS'],
    filters:['SUPPLIER','FABRIC','STATUS'],
    sql:`WITH d AS (
      SELECT ROLL_ID,SUM(ISSUE_MTR) ISSUED_MTR
      FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY ROLL_ID
    )
    SELECT r.ROLL_ID,r.INWARD_ID,r.INWARD_DATE,
      COALESCE(v.VENDOR_NAME,r.SUPPLIER_ID) SUPPLIER,r.VENDOR_ROLL_NO,
      COALESCE(f.FABRIC_NAME,r.FABRIC_ID) FABRIC,r.INWARD_MTR,
      COALESCE(d.ISSUED_MTR,0) ISSUED_MTR,
      MAX(0,r.INWARD_MTR-COALESCE(d.ISSUED_MTR,0)) BALANCE_MTR,
      CASE WHEN COALESCE(d.ISSUED_MTR,0)<=0.0001 THEN 'AVAILABLE'
           WHEN r.INWARD_MTR-COALESCE(d.ISSUED_MTR,0)<=0.0001 THEN 'FULLY ISSUED'
           ELSE 'PARTIAL' END STATUS
    FROM raw_inward r
    LEFT JOIN d ON d.ROLL_ID=r.ROLL_ID
    LEFT JOIN vendors v ON v.VENDOR_ID=r.SUPPLIER_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=r.FABRIC_ID
    WHERE COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'`
  },
  dye:{
    perm:'dye',date:'ISSUE_DATE',
    cols:['DYE_PLAN_ID','DYE_BATCH_ID','ISSUE_DATE','EXPECTED_DATE','OVERDUE_DAYS','DYE_VENDOR','FABRIC','COLOR','ROLL_COUNT','ISSUE_MTR','RECEIVED_MTR','VARIANCE_MTR','USABLE_MTR','STATUS'],
    filters:['DYE_VENDOR','FABRIC','COLOR','STATUS'],
    sql:`WITH j AS (
      SELECT DYE_PLAN_ID,DYE_BATCH_ID,MAX(ISSUE_DATE) ISSUE_DATE,MAX(DYE_VENDOR_ID) DYE_VENDOR_ID,
             MAX(FABRIC_ID) FABRIC_ID,MAX(COLOR_ID) COLOR_ID,SUM(ISSUE_MTR) ISSUE_MTR,COUNT(*) ROLL_COUNT
      FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    ),r AS (
      SELECT DYE_BATCH_ID,COALESCE(SUM(RECEIVED_MTR),0) RECEIVED_MTR,
             COALESCE(SUM(USABLE_MTR),0) USABLE_MTR,MAX(FINAL_RECEIPT) CLOSED
      FROM dye_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    )
    SELECT j.DYE_PLAN_ID,j.DYE_BATCH_ID,j.ISSUE_DATE,e.EXPECTED_DATE,
      CASE WHEN COALESCE(e.EXPECTED_DATE,'')<>'' AND COALESCE(r.CLOSED,0)=0
             AND date(e.EXPECTED_DATE)<date('now')
           THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS,
      COALESCE(v.VENDOR_NAME,j.DYE_VENDOR_ID) DYE_VENDOR,
      COALESCE(f.FABRIC_NAME,j.FABRIC_ID) FABRIC,
      COALESCE(c.COLOR_NAME,j.COLOR_ID) COLOR,
      j.ROLL_COUNT,j.ISSUE_MTR,COALESCE(r.RECEIVED_MTR,0) RECEIVED_MTR,
      CASE WHEN COALESCE(r.CLOSED,0)=1 THEN COALESCE(r.RECEIVED_MTR,0)-j.ISSUE_MTR ELSE 0 END VARIANCE_MTR,
      COALESCE(r.USABLE_MTR,0) USABLE_MTR,
      CASE WHEN COALESCE(r.CLOSED,0)=1 AND COALESCE(r.RECEIVED_MTR,0)-j.ISSUE_MTR>0.0001 THEN 'RECEIVED EXCESS'
           WHEN COALESCE(r.CLOSED,0)=1 AND COALESCE(r.RECEIVED_MTR,0)-j.ISSUE_MTR<-0.0001 THEN 'RECEIVED SHORT'
           WHEN COALESCE(r.CLOSED,0)=1 THEN 'RECEIVED EXACT'
           WHEN COALESCE(r.RECEIVED_MTR,0)>0 THEN 'PARTIAL RECEIVED'
           ELSE 'AT DYE VENDOR' END STATUS
    FROM j
    LEFT JOIN r ON r.DYE_BATCH_ID=j.DYE_BATCH_ID
    LEFT JOIN vendors v ON v.VENDOR_ID=j.DYE_VENDOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=j.FABRIC_ID
    LEFT JOIN colors c ON c.COLOR_ID=j.COLOR_ID
    LEFT JOIN record_expectations e ON e.MODULE='DYE' AND e.RECORD_ID=j.DYE_BATCH_ID`
  },
  production:{
    perm:'production',date:'PLAN_DATE',
    cols:['PRODUCTION_BATCH_ID','PLAN_DATE','STYLE','COLOR','DYE_BATCH_ID','PLANNED_QTY','ALLOCATED_MTR','ACTUAL_CONSUMED_MTR','ACTUAL_CUT_QTY','CUT_BALANCE','STATUS'],
    filters:['STYLE','DYE_BATCH_ID','STATUS'],
    sql:`WITH cl AS (
      SELECT PRODUCTION_BATCH_ID,SUM(QTY) CUT_QTY FROM production_cut_lines GROUP BY PRODUCTION_BATCH_ID
    ),il AS (
      SELECT CHALLAN_ID,SUM(QTY) QTY FROM stitching_issue_lines GROUP BY CHALLAN_ID
    ),ib AS (
      SELECT s.PRODUCTION_BATCH_ID,SUM(CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.QTY ELSE s.TOTAL_ISSUED END) ISSUED_QTY
      FROM stitching_jobs s LEFT JOIN il ON il.CHALLAN_ID=s.CHALLAN_ID
      WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY s.PRODUCTION_BATCH_ID
    )
    SELECT p.PRODUCTION_BATCH_ID,p.PLAN_DATE,COALESCE(s.STYLE_NAME,p.STYLE_ID) STYLE,
      COALESCE(c.COLOR_NAME,p.COLOR_ID) COLOR,p.DYE_BATCH_ID,p.PLANNED_QTY,p.ALLOCATED_MTR,
      COALESCE(ca.CONSUMED_MTR,p.CONSUMED_MTR,0) ACTUAL_CONSUMED_MTR,
      CASE WHEN cl.PRODUCTION_BATCH_ID IS NOT NULL THEN cl.CUT_QTY ELSE p.TOTAL_CUT END ACTUAL_CUT_QTY,
      MAX(0,(CASE WHEN cl.PRODUCTION_BATCH_ID IS NOT NULL THEN cl.CUT_QTY ELSE p.TOTAL_CUT END)-COALESCE(ib.ISSUED_QTY,0)) CUT_BALANCE,
      p.STATUS
    FROM production_batches p
    LEFT JOIN styles s ON s.STYLE_ID=p.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=p.COLOR_ID
    LEFT JOIN production_cut_actuals ca ON ca.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID AND COALESCE(ca.STATUS,'') NOT LIKE 'CANCELLED%'
    LEFT JOIN cl ON cl.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID
    LEFT JOIN ib ON ib.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID
    WHERE COALESCE(p.STATUS,'') NOT LIKE 'CANCELLED%'`
  },
  stitching:{
    perm:'stitching',date:'ISSUE_DATE',
    cols:['ISSUE_ID','ISSUE_DATE','EXPECTED_DATE','OVERDUE_DAYS','STITCHING_VENDOR','DYE_BATCH_ID','FABRIC','STYLE','COLOR','ALLOCATED_MTR','ACTUAL_ISSUED','ACTUAL_RECEIVED','PENDING_QTY','RECEIPT_COUNT','STATUS'],
    filters:['STITCHING_VENDOR','FABRIC','STYLE','COLOR','STATUS'],
    sql:`WITH il AS (
      SELECT CHALLAN_ID,SUM(QTY) ISSUE_QTY FROM stitching_issue_lines GROUP BY CHALLAN_ID
    ),rl AS (
      SELECT l.CHALLAN_ID,SUM(l.QTY) RECEIVED_QTY,COUNT(DISTINCT l.RECEIPT_ID) RECEIPT_COUNT
      FROM stitching_receipt_lines l
      JOIN stitching_receipts r ON r.RECEIPT_ID=l.RECEIPT_ID AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'
      GROUP BY l.CHALLAN_ID
    )
    SELECT s.CHALLAN_ID,COALESCE(s.ISSUE_ID,s.CHALLAN_ID) ISSUE_ID,s.ISSUE_DATE,e.EXPECTED_DATE,
      CASE WHEN COALESCE(e.EXPECTED_DATE,'')<>'' AND
        MAX(0,(CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.ISSUE_QTY ELSE s.TOTAL_ISSUED END)-
              (CASE WHEN rl.CHALLAN_ID IS NOT NULL THEN rl.RECEIVED_QTY ELSE s.TOTAL_RECEIVED END))>0
        AND date(e.EXPECTED_DATE)<date('now')
        THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS,
      COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) STITCHING_VENDOR,
      s.PRODUCTION_BATCH_ID,p.DYE_BATCH_ID,COALESCE(f.FABRIC_NAME,p.FABRIC_ID) FABRIC,p.ALLOCATED_MTR,
      COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,s.COLOR_ID) COLOR,
      CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.ISSUE_QTY ELSE s.TOTAL_ISSUED END ACTUAL_ISSUED,
      CASE WHEN rl.CHALLAN_ID IS NOT NULL THEN rl.RECEIVED_QTY ELSE s.TOTAL_RECEIVED END ACTUAL_RECEIVED,
      MAX(0,(CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.ISSUE_QTY ELSE s.TOTAL_ISSUED END)-
            (CASE WHEN rl.CHALLAN_ID IS NOT NULL THEN rl.RECEIVED_QTY ELSE s.TOTAL_RECEIVED END)) PENDING_QTY,
      COALESCE(rl.RECEIPT_COUNT,0) RECEIPT_COUNT,s.STATUS
    FROM stitching_jobs s
    LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    LEFT JOIN styles st ON st.STYLE_ID=s.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=s.COLOR_ID
    LEFT JOIN production_batches p ON p.PRODUCTION_BATCH_ID=s.PRODUCTION_BATCH_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=p.FABRIC_ID
    LEFT JOIN il ON il.CHALLAN_ID=s.CHALLAN_ID
    LEFT JOIN rl ON rl.CHALLAN_ID=s.CHALLAN_ID
    LEFT JOIN record_expectations e ON e.MODULE='STITCHING' AND e.RECORD_ID=s.CHALLAN_ID
    WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%'`
  },
  qc:{
    perm:'qc',date:'QC_DATE',
    cols:['QC_ID','QC_DATE','ISSUE_ID','SIZE_NAME','STYLE','COLOR','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','FINAL_ACCEPTED_QTY','STATUS'],
    filters:['SIZE_NAME','ISSUE_ID','STATUS'],
    sql:`SELECT q.QC_ID,q.QC_DATE,q.CHALLAN_ID,COALESCE(sj.ISSUE_ID,q.CHALLAN_ID) ISSUE_ID,COALESCE(sz.SIZE_NAME,q.SIZE) SIZE_NAME,
      COALESCE(st.STYLE_NAME,q.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,q.COLOR_ID) COLOR,
      q.QC_QTY,q.PASS_QTY,q.REWORK_QTY,q.REJECT_QTY,q.FINAL_ACCEPTED_QTY,q.STATUS
    FROM qc_events q
    LEFT JOIN stitching_jobs sj ON sj.CHALLAN_ID=q.CHALLAN_ID
    LEFT JOIN sizes sz ON sz.SIZE_ID=q.SIZE
    LEFT JOIN styles st ON st.STYLE_ID=q.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=q.COLOR_ID
    WHERE COALESCE(q.STATUS,'') NOT LIKE 'CANCELLED%'`
  },
  handover:{
    perm:'qc',date:'HANDOVER_DATE',
    cols:['HANDOVER_ID','HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE','COLOR','SIZE_NAME','ACCEPTED_QTY','TOTAL_WAREHOUSE_RECEIVED','PENDING_QTY','STATUS'],
    filters:['STYLE','COLOR','SIZE_NAME','STATUS'],
    sql:`WITH wr AS (
      SELECT HANDOVER_ID,SUM(RECEIVED_QTY) EXTRA_RECEIVED
      FROM warehouse_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY HANDOVER_ID
    )
    SELECT h.HANDOVER_ID,h.HANDOVER_DATE,h.PRODUCTION_BATCH_ID,
      COALESCE(st.STYLE_NAME,h.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,h.COLOR_ID) COLOR,
      COALESCE(sz.SIZE_NAME,h.SIZE) SIZE_NAME,h.ACCEPTED_QTY,
      h.WAREHOUSE_RECEIVED_QTY+COALESCE(wr.EXTRA_RECEIVED,0) TOTAL_WAREHOUSE_RECEIVED,
      MAX(0,h.ACCEPTED_QTY-h.WAREHOUSE_RECEIVED_QTY-COALESCE(wr.EXTRA_RECEIVED,0)) PENDING_QTY,
      h.STATUS
    FROM warehouse_handover h
    LEFT JOIN styles st ON st.STYLE_ID=h.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=h.COLOR_ID
    LEFT JOIN sizes sz ON sz.SIZE_ID=h.SIZE
    LEFT JOIN wr ON wr.HANDOVER_ID=h.HANDOVER_ID
    WHERE COALESCE(h.STATUS,'') NOT LIKE 'CANCELLED%'`
  }
};

async function allowed(context,user,cfg){
  if(user.admin)return true;
  if(!user.permissions?.[cfg.perm])return false;
  const p=await context.env.DB.prepare(
    'SELECT CAN_VIEW FROM user_action_permissions WHERE USER_ID=? AND MODULE=?'
  ).bind(user.uid,cfg.perm).first();
  return !p||Number(p.CAN_VIEW)!==0;
}
function safeFilters(raw,cfg){
  let x={};try{x=JSON.parse(raw||'{}')}catch{}
  const out={};
  for(const k of cfg.filters){
    const v=x?.[k];
    if(Array.isArray(v)&&v.length)out[k]=v.slice(0,50).map(String);
  }
  return out;
}

export async function onRequestGet(context){
  try{
    const user=await requireAuth(context);
    if(!context.env.DB)return json({error:'D1 unavailable.'},503);
    const u=new URL(context.request.url);
    const module=String(u.searchParams.get('module')||'').toLowerCase();
    const cfg=CFG[module];
    if(!cfg)return json({error:'Unsupported module.'},400);
    if(!await allowed(context,user,cfg))return json({error:'Permission denied.'},403);

    const page=Math.max(1,Number(u.searchParams.get('page')||1));
    const pageSize=Math.min(100,Math.max(10,Number(u.searchParams.get('pageSize')||25)));
    const search=String(u.searchParams.get('search')||'').trim().slice(0,100);
    const sort=cfg.cols.includes(u.searchParams.get('sort'))?u.searchParams.get('sort'):cfg.date;
    const dir=String(u.searchParams.get('dir')||'desc').toLowerCase()==='asc'?'ASC':'DESC';
    const dateFrom=String(u.searchParams.get('dateFrom')||'').slice(0,10);
    const dateTo=String(u.searchParams.get('dateTo')||'').slice(0,10);
    const filters=safeFilters(u.searchParams.get('filters'),cfg);
    const exportAll=u.searchParams.get('export')==='1';
    const facets=u.searchParams.get('facets')==='1';

    const where=[],bind=[];
    if(search){
      const q='%'+search+'%';
      where.push('('+cfg.cols.map(c=>'CAST(q."'+c+'" AS TEXT) LIKE ?').join(' OR ')+')');
      for(let i=0;i<cfg.cols.length;i++)bind.push(q);
    }
    if(dateFrom){where.push('date(q."'+cfg.date+'")>=date(?)');bind.push(dateFrom)}
    if(dateTo){where.push('date(q."'+cfg.date+'")<=date(?)');bind.push(dateTo)}
    for(const [k,vals] of Object.entries(filters)){
      where.push('CAST(q."'+k+'" AS TEXT) IN ('+vals.map(()=>'?').join(',')+')');
      bind.push(...vals);
    }
    const suffix=where.length?' WHERE '+where.join(' AND '):'';
    const base='SELECT * FROM ('+cfg.sql+') q';
    const count=(await context.env.DB.prepare('SELECT COUNT(*) total FROM ('+base+suffix+') z').bind(...bind).first())?.total||0;

    let items;
    if(exportAll){
      if(Number(count)>10000)return json({error:'Filtered export exceeds 10,000 rows. Narrow filters first.'},413);
      items=(await context.env.DB.prepare(base+suffix+' ORDER BY q."'+sort+'" '+dir+' LIMIT 10000').bind(...bind).all()).results||[];
    }else{
      const off=(page-1)*pageSize;
      items=(await context.env.DB.prepare(base+suffix+' ORDER BY q."'+sort+'" '+dir+' LIMIT ? OFFSET ?').bind(...bind,pageSize,off).all()).results||[];
    }

    const result={module,items,total:Number(count),page,pageSize,columns:cfg.cols,filterColumns:cfg.filters,dateColumn:cfg.date};
    if(facets){
      result.facets={};
      for(const k of cfg.filters){
        const r=(await context.env.DB.prepare(
          `SELECT DISTINCT CAST(q."${k}" AS TEXT) value FROM (${cfg.sql}) q WHERE q."${k}" IS NOT NULL AND CAST(q."${k}" AS TEXT)<>'' ORDER BY value LIMIT 100`
        ).all()).results||[];
        result.facets[k]=r.map(x=>x.value);
      }
    }
    return json(result);
  }catch(e){return errorResponse(e)}
}
