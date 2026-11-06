create or replace function public.list_wms_shipment_history(p_shipment_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with related_entities as (
    select 'shipment'::text as entity_type, p_shipment_id as entity_id
    union all
    select 'warehouse_work', w.id from wms.warehouse_work w where w.shipment_id = p_shipment_id
    union all
    select 'pick_task', pt.id from wms.pick_tasks pt
      join wms.warehouse_work w on w.id = pt.warehouse_work_id where w.shipment_id = p_shipment_id
    union all
    select 'package', p.id from wms.packages p
      join wms.warehouse_work w on w.id = p.warehouse_work_id where w.shipment_id = p_shipment_id
    union all
    select 'dispatch', d.id from wms.dispatches d
      join wms.warehouse_work w on w.id = d.warehouse_work_id where w.shipment_id = p_shipment_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'entity_type', a.entity_type, 'action', a.action,
    'occurred_at', a.occurred_at, 'details', a.details
  ) order by a.occurred_at desc), '[]'::jsonb)
  from wms.audit_events a
  where exists (select 1 from related_entities r
    where r.entity_type = a.entity_type and r.entity_id = a.entity_id);
$$;

revoke all on function public.list_wms_shipment_history(uuid) from public, anon, authenticated;
grant execute on function public.list_wms_shipment_history(uuid) to service_role;
