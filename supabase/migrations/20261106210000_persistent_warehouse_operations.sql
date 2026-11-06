-- Persistent warehouse execution operations for Zhister WMS.
-- Applied to the connected Supabase project on 2026-11-06.

create or replace function public.wms_review_shipment(p_shipment_id uuid,p_eligibility wms.eligibility_status,p_actor uuid,p_reason text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_shipment wms.shipments%rowtype; v_work wms.warehouse_work%rowtype; v_task_id uuid; v_lines integer;
begin
  if p_eligibility not in ('eligible'::wms.eligibility_status,'not_eligible'::wms.eligibility_status,'on_hold'::wms.eligibility_status) then raise exception 'Unsupported eligibility decision'; end if;
  select * into v_shipment from wms.shipments where id=p_shipment_id for update;
  if not found then raise exception 'Shipment not found'; end if;
  if p_eligibility='eligible'::wms.eligibility_status and regexp_replace(lower(coalesce(v_shipment.distribution_model,'')),'[^a-z]','','g') in ('dropship','dropshipment') then raise exception 'DropShipment cannot be approved for warehouse picking'; end if;
  update wms.shipments set eligibility=p_eligibility,updated_at=now() where id=p_shipment_id;
  insert into wms.warehouse_work(shipment_id,eligibility,status,hold_reason,reviewed_by,reviewed_at,updated_at)
  values(p_shipment_id,p_eligibility,case when p_eligibility='eligible'::wms.eligibility_status then 'ready_to_pick'::wms.work_status else 'on_hold'::wms.work_status end,
    case when p_eligibility='eligible'::wms.eligibility_status then null else coalesce(nullif(trim(p_reason),''),'Warehouse review decision: '||p_eligibility::text) end,p_actor,now(),now())
  on conflict(shipment_id) do update set eligibility=excluded.eligibility,
    status=case when excluded.eligibility='eligible'::wms.eligibility_status and wms.warehouse_work.status in ('not_started'::wms.work_status,'on_hold'::wms.work_status) then 'ready_to_pick'::wms.work_status
      when excluded.eligibility<>'eligible'::wms.eligibility_status and wms.warehouse_work.status in ('not_started'::wms.work_status,'on_hold'::wms.work_status,'ready_to_pick'::wms.work_status) then 'on_hold'::wms.work_status else wms.warehouse_work.status end,
    hold_reason=case when excluded.eligibility='eligible'::wms.eligibility_status then null else excluded.hold_reason end,
    reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=now()
  returning * into v_work;
  if p_eligibility='eligible'::wms.eligibility_status then
    select count(*) into v_lines from wms.shipment_lines where shipment_id=p_shipment_id and coalesce(requested_quantity,0)>0;
    if v_lines=0 then raise exception 'Shipment has no positive requested article quantities'; end if;
    select id into v_task_id from wms.pick_tasks where warehouse_work_id=v_work.id and status<>'cancelled'::wms.pick_task_status order by created_at desc limit 1;
    if v_task_id is null then insert into wms.pick_tasks(warehouse_work_id,status) values(v_work.id,'open'::wms.pick_task_status) returning id into v_task_id; end if;
    insert into wms.pick_task_lines(pick_task_id,shipment_line_id,quantity_to_pick,quantity_picked)
    select v_task_id,l.id,l.requested_quantity,0 from wms.shipment_lines l where l.shipment_id=p_shipment_id and coalesce(l.requested_quantity,0)>0
      and not exists(select 1 from wms.pick_task_lines pl where pl.pick_task_id=v_task_id and pl.shipment_line_id=l.id);
  end if;
  insert into wms.audit_events(entity_type,entity_id,action,actor_user_id,details)
  values('shipment',p_shipment_id,'eligibility_reviewed',p_actor,jsonb_build_object('eligibility',p_eligibility,'reason',p_reason));
  return jsonb_build_object('shipment_id',p_shipment_id,'eligibility',p_eligibility,'warehouse_work_id',v_work.id,'pick_task_id',v_task_id);
end $$;

create or replace function public.wms_update_pick_line(p_pick_task_id uuid,p_shipment_line_id uuid,p_quantity_picked numeric,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_line wms.pick_task_lines%rowtype; v_work_id uuid; v_all_done boolean;
begin
  if p_quantity_picked<0 then raise exception 'Picked quantity cannot be negative'; end if;
  select pl.* into v_line from wms.pick_task_lines pl join wms.pick_tasks pt on pt.id=pl.pick_task_id
    where pl.pick_task_id=p_pick_task_id and pl.shipment_line_id=p_shipment_line_id and pt.status in ('open'::wms.pick_task_status,'in_progress'::wms.pick_task_status) for update of pl;
  if not found then raise exception 'Open pick line not found'; end if;
  if p_quantity_picked>v_line.quantity_to_pick then raise exception 'Picked quantity exceeds required quantity'; end if;
  update wms.pick_task_lines set quantity_picked=p_quantity_picked,picked_at=case when p_quantity_picked=quantity_to_pick then now() else null end where id=v_line.id;
  select warehouse_work_id into v_work_id from wms.pick_tasks where id=p_pick_task_id;
  select coalesce(bool_and(quantity_picked>=quantity_to_pick),false) into v_all_done from wms.pick_task_lines where pick_task_id=p_pick_task_id;
  if v_all_done then
    update wms.pick_tasks set status='completed'::wms.pick_task_status,completed_at=now(),updated_at=now() where id=p_pick_task_id;
    update wms.warehouse_work set status='packing'::wms.work_status,updated_at=now() where id=v_work_id;
  else
    update wms.pick_tasks set status='in_progress'::wms.pick_task_status,started_at=coalesce(started_at,now()),updated_at=now() where id=p_pick_task_id;
    update wms.warehouse_work set status='picking'::wms.work_status,updated_at=now() where id=v_work_id;
  end if;
  insert into wms.audit_events(entity_type,entity_id,action,actor_user_id,details)
  values('pick_task',p_pick_task_id,'pick_quantity_updated',p_actor,jsonb_build_object('shipment_line_id',p_shipment_line_id,'quantity_picked',p_quantity_picked,'complete',v_all_done));
  return jsonb_build_object('pick_task_id',p_pick_task_id,'shipment_line_id',p_shipment_line_id,'quantity_picked',p_quantity_picked,'complete',v_all_done);
end $$;

create or replace function public.wms_pack_shipment(p_warehouse_work_id uuid,p_package_type text,p_weight_kg numeric,p_length_cm numeric,p_width_cm numeric,p_height_cm numeric,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_package_id uuid; v_package_number integer; v_task_id uuid;
begin
  if coalesce(p_weight_kg,0)<=0 or coalesce(p_length_cm,0)<=0 or coalesce(p_width_cm,0)<=0 or coalesce(p_height_cm,0)<=0 then raise exception 'Package weight and all dimensions must be greater than zero'; end if;
  select id into v_task_id from wms.pick_tasks where warehouse_work_id=p_warehouse_work_id and status='completed'::wms.pick_task_status order by completed_at desc limit 1;
  if v_task_id is null then raise exception 'Picking must be completed before packing'; end if;
  if not exists(select 1 from wms.warehouse_work where id=p_warehouse_work_id and status='packing'::wms.work_status for update) then raise exception 'Warehouse work is not awaiting packing'; end if;
  select coalesce(max(package_number),0)+1 into v_package_number from wms.packages where warehouse_work_id=p_warehouse_work_id;
  insert into wms.packages(warehouse_work_id,package_number,package_type,weight_kg,length_cm,width_cm,height_cm,status,packed_by,packed_at)
  values(p_warehouse_work_id,v_package_number,coalesce(nullif(trim(p_package_type),''),'parcel'),p_weight_kg,p_length_cm,p_width_cm,p_height_cm,'packed'::wms.package_status,p_actor,now()) returning id into v_package_id;
  insert into wms.package_lines(package_id,shipment_line_id,quantity)
  select v_package_id,pl.shipment_line_id,pl.quantity_picked from wms.pick_task_lines pl where pl.pick_task_id=v_task_id and pl.quantity_picked>0;
  if not exists(select 1 from wms.package_lines where package_id=v_package_id) then raise exception 'No picked quantities are available to pack'; end if;
  update wms.warehouse_work set status='ready_to_dispatch'::wms.work_status,updated_at=now() where id=p_warehouse_work_id;
  insert into wms.audit_events(entity_type,entity_id,action,actor_user_id,details)
  values('package',v_package_id,'package_packed',p_actor,jsonb_build_object('warehouse_work_id',p_warehouse_work_id,'package_number',v_package_number));
  return jsonb_build_object('package_id',v_package_id,'package_number',v_package_number,'warehouse_work_id',p_warehouse_work_id);
end $$;

create or replace function public.wms_prepare_dispatch(p_warehouse_work_id uuid,p_carrier text,p_tracking_reference text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_dispatch_id uuid;
begin
  if nullif(trim(coalesce(p_carrier,'')),'') is null then raise exception 'Carrier is required'; end if;
  if not exists(select 1 from wms.warehouse_work where id=p_warehouse_work_id and status='ready_to_dispatch'::wms.work_status) then raise exception 'Shipment is not ready for dispatch'; end if;
  if not exists(select 1 from wms.packages where warehouse_work_id=p_warehouse_work_id and status='packed'::wms.package_status) then raise exception 'A packed package is required before dispatch'; end if;
  insert into wms.dispatches(warehouse_work_id,status,carrier,tracking_reference,created_by)
  values(p_warehouse_work_id,'prepared'::wms.dispatch_status,trim(p_carrier),nullif(trim(p_tracking_reference),''),p_actor) returning id into v_dispatch_id;
  insert into wms.audit_events(entity_type,entity_id,action,actor_user_id,details)
  values('dispatch',v_dispatch_id,'dispatch_prepared',p_actor,jsonb_build_object('carrier',p_carrier,'tracking_reference',p_tracking_reference));
  return jsonb_build_object('dispatch_id',v_dispatch_id,'status','prepared');
end $$;

create or replace function public.wms_confirm_dispatch(p_dispatch_id uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_work_id uuid;
begin
  update wms.dispatches set status='handed_over'::wms.dispatch_status,handed_over_at=now(),updated_at=now()
    where id=p_dispatch_id and status='prepared'::wms.dispatch_status returning warehouse_work_id into v_work_id;
  if v_work_id is null then raise exception 'Prepared dispatch not found'; end if;
  update wms.warehouse_work set status='dispatched'::wms.work_status,updated_at=now() where id=v_work_id;
  insert into wms.audit_events(entity_type,entity_id,action,actor_user_id,details)
  values('dispatch',p_dispatch_id,'carrier_handover_confirmed',p_actor,jsonb_build_object('warehouse_work_id',v_work_id));
  return jsonb_build_object('dispatch_id',p_dispatch_id,'warehouse_work_id',v_work_id,'status','handed_over');
end $$;

create or replace function public.list_wms_shipments()
returns jsonb language sql security invoker set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'external_shipment_id',s.external_shipment_id,'external_shipment_number',s.external_shipment_number,
  'external_order_number',s.external_order_number,'source_status',s.source_status,'distribution_model',s.distribution_model,
  'eligibility',s.eligibility,'last_synced_at',s.last_synced_at,'created_at',s.created_at,
  'shipment_lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'line_number',l.line_number,'supplier_article_number',l.supplier_article_number,
    'buyer_article_number',l.buyer_article_number,'description',l.description,'requested_quantity',l.requested_quantity,
    'confirmed_quantity',l.confirmed_quantity,'dispatched_quantity',l.dispatched_quantity) order by l.line_number) from wms.shipment_lines l where l.shipment_id=s.id),'[]'::jsonb),
  'warehouse_work',coalesce((select jsonb_build_object(
    'id',w.id,'eligibility',w.eligibility,'status',w.status,'hold_reason',w.hold_reason,
    'pick_task',coalesce((select jsonb_build_object('id',pt.id,'status',pt.status,'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pl.id,'shipment_line_id',pl.shipment_line_id,'quantity_to_pick',pl.quantity_to_pick,'quantity_picked',pl.quantity_picked))
      from wms.pick_task_lines pl where pl.pick_task_id=pt.id),'[]'::jsonb))
      from wms.pick_tasks pt where pt.warehouse_work_id=w.id and pt.status<>'cancelled'::wms.pick_task_status order by pt.created_at desc limit 1),'{}'::jsonb),
    'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'package_number',p.package_number,'package_type',p.package_type,'weight_kg',p.weight_kg,
      'length_cm',p.length_cm,'width_cm',p.width_cm,'height_cm',p.height_cm,'status',p.status) order by p.package_number) from wms.packages p where p.warehouse_work_id=w.id),'[]'::jsonb),
    'dispatches',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'carrier',d.carrier,'tracking_reference',d.tracking_reference,
      'handed_over_at',d.handed_over_at,'confirmed_at',d.confirmed_at) order by d.created_at desc) from wms.dispatches d where d.warehouse_work_id=w.id),'[]'::jsonb)
  ) from wms.warehouse_work w where w.shipment_id=s.id),'{}'::jsonb)
) order by s.created_at desc),'[]'::jsonb) from wms.shipments s;
$$;

grant usage on schema wms to service_role;
grant all privileges on all tables in schema wms to service_role;
grant usage,select on all sequences in schema wms to service_role;
revoke all on function public.wms_review_shipment(uuid,wms.eligibility_status,uuid,text) from public,anon,authenticated;
revoke all on function public.wms_update_pick_line(uuid,uuid,numeric,uuid) from public,anon,authenticated;
revoke all on function public.wms_pack_shipment(uuid,text,numeric,numeric,numeric,numeric,uuid) from public,anon,authenticated;
revoke all on function public.wms_prepare_dispatch(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.wms_confirm_dispatch(uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_wms_shipments() from public,anon,authenticated;
revoke all on function public.import_wms_shipment(jsonb) from public,anon,authenticated;
revoke all on function public.record_wms_sync_run(jsonb) from public,anon,authenticated;
grant execute on function public.wms_review_shipment(uuid,wms.eligibility_status,uuid,text) to service_role;
grant execute on function public.wms_update_pick_line(uuid,uuid,numeric,uuid) to service_role;
grant execute on function public.wms_pack_shipment(uuid,text,numeric,numeric,numeric,numeric,uuid) to service_role;
grant execute on function public.wms_prepare_dispatch(uuid,text,text,uuid) to service_role;
grant execute on function public.wms_confirm_dispatch(uuid,uuid) to service_role;
grant execute on function public.list_wms_shipments() to service_role;
grant execute on function public.import_wms_shipment(jsonb) to service_role;
grant execute on function public.record_wms_sync_run(jsonb) to service_role;
