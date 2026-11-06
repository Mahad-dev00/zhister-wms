create or replace function public.wms_update_pick_line(
 p_pick_task_id uuid,p_shipment_line_id uuid,p_quantity_picked numeric,p_actor uuid
)
returns jsonb language plpgsql set search_path = '' as $$
declare v_line wms.pick_task_lines%rowtype;v_work_id uuid;v_all_done boolean;
begin
 if p_quantity_picked<0 then raise exception 'Picked quantity cannot be negative';end if;
 select pl.* into v_line from wms.pick_task_lines pl
 join wms.pick_tasks pt on pt.id=pl.pick_task_id
 join wms.warehouse_work ww on ww.id=pt.warehouse_work_id
 where pl.pick_task_id=p_pick_task_id and pl.shipment_line_id=p_shipment_line_id
 and pt.status in ('open'::wms.pick_task_status,'in_progress'::wms.pick_task_status)
 and ww.eligibility='eligible'::wms.eligibility_status
 and ww.status in ('ready_to_pick'::wms.work_status,'picking'::wms.work_status)
 for update of pl;
 if not found then raise exception 'Open pick line not found or warehouse work is on hold';end if;
 if p_quantity_picked>v_line.quantity_to_pick then raise exception 'Picked quantity exceeds required quantity';end if;
 update wms.pick_task_lines set quantity_picked=p_quantity_picked,
 picked_at=case when p_quantity_picked=quantity_to_pick then now() else null end where id=v_line.id;
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
 values('pick_task',p_pick_task_id,'pick_quantity_updated',p_actor,
 jsonb_build_object('shipment_line_id',p_shipment_line_id,'quantity_picked',p_quantity_picked,'complete',v_all_done));
 return jsonb_build_object('pick_task_id',p_pick_task_id,'shipment_line_id',p_shipment_line_id,'quantity_picked',p_quantity_picked,'complete',v_all_done);
end;$$;

create or replace function public.list_wms_inventory()
returns jsonb language sql stable set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',a.id,'article_code',a.article_code,'supplier_article_number',a.supplier_article_number,
 'buyer_article_number',a.buyer_article_number,'description',a.description,'location_id',l.id,
 'location_code',l.code,'on_hand',coalesce(b.on_hand,0),'allocated',coalesce(x.allocated,0),
 'available',coalesce(b.on_hand,0)-coalesce(x.allocated,0)
 ) order by a.article_code),'[]'::jsonb)
 from wms.articles a cross join wms.locations l
 left join (select article_id,location_id,sum(quantity_delta) as on_hand from wms.stock_movements group by article_id,location_id) b
 on b.article_id=a.id and b.location_id=l.id
 left join (
  select sl.article_id,ptl.location_id,sum(greatest(ptl.quantity_to_pick-ptl.quantity_picked,0)) as allocated
  from wms.pick_task_lines ptl
  join wms.pick_tasks pt on pt.id=ptl.pick_task_id and pt.status in ('open'::wms.pick_task_status,'in_progress'::wms.pick_task_status)
  join wms.warehouse_work ww on ww.id=pt.warehouse_work_id and ww.eligibility='eligible'::wms.eligibility_status
    and ww.status in ('ready_to_pick'::wms.work_status,'picking'::wms.work_status)
  join wms.shipment_lines sl on sl.id=ptl.shipment_line_id
  group by sl.article_id,ptl.location_id
 ) x on x.article_id=a.id and x.location_id=l.id
 where l.is_active;
$$;
