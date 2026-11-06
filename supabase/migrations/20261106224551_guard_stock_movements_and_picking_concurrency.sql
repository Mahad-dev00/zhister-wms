create or replace function wms.record_pick_stock_movement()
returns trigger language plpgsql set search_path = '' as $$
declare v_article_id uuid;v_delta numeric;v_on_hand numeric;v_location_id uuid;
begin
 v_delta:=coalesce(new.quantity_picked,0)-coalesce(old.quantity_picked,0);
 if v_delta=0 then return new;end if;
 select sl.article_id into v_article_id from wms.shipment_lines sl where sl.id=new.shipment_line_id;
 if v_article_id is null then raise exception 'This order line has no article master record. Refresh the shipment before picking.';end if;
 v_location_id:=coalesce(new.location_id,old.location_id);
 perform 1 from wms.locations where id=v_location_id for update;
 select coalesce(sum(sm.quantity_delta),0) into v_on_hand from wms.stock_movements sm
 where sm.article_id=v_article_id and sm.location_id=v_location_id;
 if v_delta>0 and v_on_hand<v_delta then raise exception 'Insufficient stock at the assigned location. Record a receipt or stock adjustment before picking.';end if;
 insert into wms.stock_movements(article_id,location_id,movement_type,quantity_delta,reference,note)
 values(v_article_id,v_location_id,case when v_delta>0 then 'pick' else 'pick_reversal' end,-v_delta,
 'Pick task '||new.pick_task_id::text,case when v_delta>0 then 'Stock consumed by confirmed picking' else 'Picked quantity was reversed' end);
 return new;
end;$$;
create or replace function public.record_wms_stock_movement(
 p_article_code text,p_location_code text,p_quantity_delta numeric,p_movement_type text,
 p_reference text,p_note text,p_actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_article uuid;v_location uuid;v_on_hand numeric;v_id uuid;
begin
 if p_quantity_delta is null or p_quantity_delta=0 then raise exception 'Enter a non-zero stock quantity';end if;
 if p_movement_type not in ('receipt','adjustment') then raise exception 'Unsupported stock movement type';end if;
 if p_movement_type='receipt' and p_quantity_delta<=0 then raise exception 'Received quantity must be positive';end if;
 select id into v_article from wms.articles where article_code=trim(p_article_code);
 if v_article is null then raise exception 'Article not found. Import an order containing this article first.';end if;
 select id into v_location from wms.locations where code=trim(p_location_code) and is_active=true;
 if v_location is null then raise exception 'Active warehouse location not found';end if;
 perform 1 from wms.locations where id=v_location for update;
 select coalesce(sum(quantity_delta),0) into v_on_hand from wms.stock_movements where article_id=v_article and location_id=v_location;
 if v_on_hand+p_quantity_delta<0 then raise exception 'This adjustment would make on-hand stock negative';end if;
 insert into wms.stock_movements(article_id,location_id,movement_type,quantity_delta,reference,note,actor_user_id)
 values(v_article,v_location,p_movement_type,p_quantity_delta,nullif(trim(p_reference),''),nullif(trim(p_note),''),p_actor)
 returning id into v_id;
 insert into wms.audit_events(entity_type,entity_id,action,actor_user_id,details)
 values('stock_movement',v_id,'stock_'||p_movement_type,p_actor,
 jsonb_build_object('article_code',p_article_code,'location_code',p_location_code,'quantity_delta',p_quantity_delta,'reference',p_reference,'note',p_note));
 return jsonb_build_object('movement_id',v_id,'article_code',p_article_code,'location_code',p_location_code,'quantity_delta',p_quantity_delta);
end;$$;