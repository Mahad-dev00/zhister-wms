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
  where (o.first_seen_at >= p_from and o.first_seen_at < p_to)
     or exists (
       select 1
       from wms.shipments s
       join wms.warehouse_work w on w.shipment_id=s.id
       where s.external_order_number=o.order_number
         and w.status <> 'dispatched'::wms.work_status
         and w.eligibility <> 'not_eligible'::wms.eligibility_status
     );
$$;
