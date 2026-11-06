-- Zhister-owned order index.
-- first_seen_at is set once by Zhister and never replaced by source timestamps.

create table if not exists wms.order_index (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  first_seen_at timestamptz not null default now(),
  source text not null default 'wms',
  last_checked_at timestamptz,
  tracking_payload jsonb not null default '{}'::jsonb,
  tracking_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_index_order_number_nonempty check (length(trim(order_number)) > 0)
);

create index if not exists order_index_first_seen_at_idx
  on wms.order_index(first_seen_at desc);

alter table wms.order_index enable row level security;
revoke all on wms.order_index from public, anon, authenticated;
grant all privileges on wms.order_index to service_role;

create or replace function public.record_wms_order_index(
  p_order_number text,
  p_source text default 'wms'
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare v_row wms.order_index%rowtype;
begin
  if nullif(trim(coalesce(p_order_number,'')),'') is null then
    raise exception 'Order number is required';
  end if;
  insert into wms.order_index(order_number,source)
  values(trim(p_order_number),coalesce(nullif(trim(p_source),''),'wms'))
  on conflict(order_number) do update set
    source=case when wms.order_index.source='wms' then excluded.source else wms.order_index.source end,
    updated_at=now()
  returning * into v_row;
  return jsonb_build_object(
    'order_number',v_row.order_number,
    'first_seen_at',v_row.first_seen_at,
    'source',v_row.source
  );
end;
$$;

create or replace function public.list_wms_order_index(
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language sql security invoker set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_number',o.order_number,
    'first_seen_at',o.first_seen_at,
    'last_checked_at',o.last_checked_at,
    'shipment_count',(select count(*) from wms.shipments s where s.external_order_number=o.order_number),
    'shipment_keys',(select coalesce(jsonb_agg(jsonb_build_object(
      'shipment_key',s.external_shipment_id,
      'shipment_number',s.external_shipment_number
    ) order by s.created_at),'[]'::jsonb) from wms.shipments s where s.external_order_number=o.order_number)
  ) order by o.first_seen_at),'[]'::jsonb)
  from wms.order_index o
  where o.first_seen_at >= p_from and o.first_seen_at < p_to;
$$;

create or replace function public.record_wms_order_tracking(
  p_order_number text,
  p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare v_row wms.order_index%rowtype;
begin
  update wms.order_index
  set tracking_payload=coalesce(p_payload,'{}'::jsonb),
      tracking_updated_at=now(),
      last_checked_at=now(),
      updated_at=now()
  where order_number=trim(p_order_number)
  returning * into v_row;
  if not found then raise exception 'Order number is not in the Zhister order index'; end if;
  return jsonb_build_object('order_number',v_row.order_number,'tracking_updated_at',v_row.tracking_updated_at);
end;
$$;

revoke all on function public.record_wms_order_index(text,text) from public,anon,authenticated;
revoke all on function public.list_wms_order_index(timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.record_wms_order_tracking(text,jsonb) from public,anon,authenticated;
grant execute on function public.record_wms_order_index(text,text) to service_role;
grant execute on function public.list_wms_order_index(timestamptz,timestamptz) to service_role;
grant execute on function public.record_wms_order_tracking(text,jsonb) to service_role;

-- Backfill orders already represented by imported shipments. The first-seen time
-- is the original local database created_at and remains stable on future refreshes.
insert into wms.order_index(order_number,first_seen_at,source)
select external_order_number,min(created_at),'shipment_import'
from wms.shipments
where nullif(trim(external_order_number),'') is not null
group by external_order_number
on conflict(order_number) do nothing;

-- Every subsequent shipment import registers its order without resetting first_seen_at.
create or replace function public.import_wms_shipment(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_shipment jsonb; v_dispatch jsonb; v_external_id text; v_shipment_number text; v_order_number text;
  v_status text; v_model text; v_eligibility wms.eligibility_status; v_shipment_id uuid; v_work_id uuid;
  v_line_count integer:=0; v_has_activity boolean:=false; v_source_lines jsonb; v_existing_lines jsonb; v_lines_changed boolean:=false;
begin
  v_shipment:=coalesce(p_payload->'Shipment',p_payload->'shipment',p_payload);
  v_external_id:=coalesce(v_shipment->>'ShipmentKey',v_shipment->>'ShipmentNumber');
  if nullif(trim(v_external_id),'') is null then raise exception 'Zhipster shipment has no stable ShipmentKey or ShipmentNumber'; end if;
  v_shipment_number:=v_shipment->>'ShipmentNumber';
  v_status:=coalesce(v_shipment->>'ShipmentStatus',v_shipment->>'Status');
  v_model:=coalesce(v_shipment->'TransportInformation'->>'DistributionModel',v_shipment->>'DistributionModel');
  v_dispatch:=coalesce(v_shipment->'DispatchOrders',p_payload->'DispatchOrders','[]'::jsonb);
  if jsonb_typeof(v_dispatch)<>'array' then raise exception 'Zhipster DispatchOrders payload is not an array'; end if;
  if regexp_replace(lower(coalesce(v_model,'')),'[^a-z]','','g') in ('dropship','dropshipment') then
    v_eligibility:='not_eligible'::wms.eligibility_status;
  else v_eligibility:='needs_review'::wms.eligibility_status; end if;

  select ord.value->>'OrderNumber' into v_order_number
  from jsonb_array_elements(v_dispatch) d(value)
  cross join lateral jsonb_array_elements(coalesce(d.value->'OrderReferences'->'Orders','[]'::jsonb)) ord(value)
  where nullif(ord.value->>'OrderNumber','') is not null limit 1;

  insert into wms.shipments(external_shipment_id,external_shipment_number,external_order_number,source_status,distribution_model,eligibility,raw_payload,last_synced_at,updated_at)
  values(v_external_id,v_shipment_number,v_order_number,v_status,v_model,v_eligibility,p_payload,now(),now())
  on conflict(external_shipment_id) do update set
    external_shipment_number=excluded.external_shipment_number,
    external_order_number=coalesce(excluded.external_order_number,wms.shipments.external_order_number),
    source_status=excluded.source_status,distribution_model=excluded.distribution_model,
    eligibility=case when excluded.eligibility='not_eligible'::wms.eligibility_status then excluded.eligibility else wms.shipments.eligibility end,
    raw_payload=excluded.raw_payload,last_synced_at=now(),updated_at=now()
  returning id into v_shipment_id;

  if nullif(trim(coalesce(v_order_number,'')),'') is not null then
    insert into wms.order_index(order_number,source)
    values(trim(v_order_number),'shipment_import')
    on conflict(order_number) do update set updated_at=now();
  end if;

  select id into v_work_id from wms.warehouse_work where shipment_id=v_shipment_id;
  if v_work_id is not null then
    select exists(select 1 from wms.pick_task_lines pl join wms.pick_tasks pt on pt.id=pl.pick_task_id where pt.warehouse_work_id=v_work_id)
      or exists(select 1 from wms.packages p where p.warehouse_work_id=v_work_id)
      or exists(select 1 from wms.dispatches d where d.warehouse_work_id=v_work_id) into v_has_activity;
  end if;

  with source_lines as (
    select line.value as line_payload,row_number() over()::integer as line_number
    from jsonb_array_elements(v_dispatch) d(value)
    cross join lateral jsonb_array_elements(coalesce(d.value->'DispatchOrderLines','[]'::jsonb)) line(value)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'line_number',line_number,'external_line_id',coalesce(line_payload->>'DispatchOrderLineKey',line_payload->>'DispatchLineKey'),
    'supplier_article_number',coalesce(line_payload->>'SuppliersArticleNumber',line_payload->>'SupplierArticleNumber'),
    'buyer_article_number',coalesce(line_payload->>'BuyersArticleNumber',line_payload->>'BuyerArticleNumber'),
    'description',line_payload->>'ArticleDescription','requested_quantity',nullif(line_payload->>'RequestedQuantity','')::numeric,
    'confirmed_quantity',nullif(line_payload->>'ConfirmedQuantity','')::numeric,'dispatched_quantity',nullif(line_payload->>'DispatchedQuantity','')::numeric
  ) order by line_number),'[]'::jsonb) into v_source_lines from source_lines;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_number',line_number,'external_line_id',external_line_id,'supplier_article_number',supplier_article_number,
    'buyer_article_number',buyer_article_number,'description',description,'requested_quantity',requested_quantity,
    'confirmed_quantity',confirmed_quantity,'dispatched_quantity',dispatched_quantity
  ) order by line_number),'[]'::jsonb) into v_existing_lines
  from wms.shipment_lines where shipment_id=v_shipment_id;

  v_lines_changed:=v_source_lines is distinct from v_existing_lines;
  if v_has_activity then
    if v_lines_changed then
      update wms.shipments set eligibility='on_hold'::wms.eligibility_status,updated_at=now() where id=v_shipment_id;
      update wms.warehouse_work set eligibility='on_hold'::wms.eligibility_status,
        status=case when status='dispatched'::wms.work_status then status else 'on_hold'::wms.work_status end,
        hold_reason='Zhipster article lines changed after warehouse work began. Reconcile the shipment before continuing.',updated_at=now()
      where id=v_work_id;
      v_eligibility:='on_hold'::wms.eligibility_status;
    end if;
    select count(*) into v_line_count from wms.shipment_lines where shipment_id=v_shipment_id;
  else
    delete from wms.shipment_lines where shipment_id=v_shipment_id;
    with source_lines as (
      select line.value as line_payload,row_number() over()::integer as line_number
      from jsonb_array_elements(v_dispatch) d(value)
      cross join lateral jsonb_array_elements(coalesce(d.value->'DispatchOrderLines','[]'::jsonb)) line(value)
    )
    insert into wms.shipment_lines(shipment_id,line_number,external_line_id,supplier_article_number,buyer_article_number,description,requested_quantity,confirmed_quantity,dispatched_quantity,raw_payload)
    select v_shipment_id,line_number,coalesce(line_payload->>'DispatchOrderLineKey',line_payload->>'DispatchLineKey'),
      coalesce(line_payload->>'SuppliersArticleNumber',line_payload->>'SupplierArticleNumber'),
      coalesce(line_payload->>'BuyersArticleNumber',line_payload->>'BuyerArticleNumber'),
      line_payload->>'ArticleDescription',nullif(line_payload->>'RequestedQuantity','')::numeric,
      nullif(line_payload->>'ConfirmedQuantity','')::numeric,nullif(line_payload->>'DispatchedQuantity','')::numeric,line_payload
    from source_lines;
    get diagnostics v_line_count=row_count;
  end if;

  insert into wms.warehouse_work(shipment_id,eligibility,status,hold_reason,updated_at)
  values(v_shipment_id,v_eligibility,'on_hold'::wms.work_status,
    case when v_eligibility='not_eligible'::wms.eligibility_status then 'Zhipster distribution model indicates drop shipment; excluded from warehouse picking.'
      when v_eligibility='on_hold'::wms.eligibility_status then 'Zhipster article lines changed after warehouse work began; reconcile before continuing.'
      else 'Distribution model or fulfilment responsibility requires warehouse review.' end,now())
  on conflict(shipment_id) do update set
    eligibility=case when excluded.eligibility in ('not_eligible'::wms.eligibility_status,'on_hold'::wms.eligibility_status) then excluded.eligibility else wms.warehouse_work.eligibility end,
    status=case when excluded.eligibility in ('not_eligible'::wms.eligibility_status,'on_hold'::wms.eligibility_status)
      and wms.warehouse_work.status<>'dispatched'::wms.work_status then 'on_hold'::wms.work_status else wms.warehouse_work.status end,
    hold_reason=case when excluded.eligibility in ('not_eligible'::wms.eligibility_status,'on_hold'::wms.eligibility_status) then excluded.hold_reason else wms.warehouse_work.hold_reason end,
    updated_at=now();

  return jsonb_build_object('shipment_id',v_shipment_id,'external_shipment_id',v_external_id,
    'external_shipment_number',v_shipment_number,'external_order_number',v_order_number,'eligibility',v_eligibility,
    'line_count',v_line_count,'warehouse_lines_held_for_review',v_has_activity and v_lines_changed);
end;
$$;
revoke all on function public.import_wms_shipment(jsonb) from public,anon,authenticated;
grant execute on function public.import_wms_shipment(jsonb) to service_role;


create or replace function public.touch_wms_order_index(p_order_number text)
returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare v_row wms.order_index%rowtype;
begin
  update wms.order_index set last_checked_at=now(),updated_at=now()
  where order_number=trim(p_order_number) returning * into v_row;
  if not found then raise exception 'Order number is not in the Zhister order index'; end if;
  return jsonb_build_object('order_number',v_row.order_number,'last_checked_at',v_row.last_checked_at);
end;
$$;
revoke all on function public.touch_wms_order_index(text) from public,anon,authenticated;
grant execute on function public.touch_wms_order_index(text) to service_role;
