create table if not exists wms.articles (
  id uuid primary key default gen_random_uuid(),
  article_code text not null unique,
  supplier_article_number text,
  buyer_article_number text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists wms.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into wms.locations(code,name) values ('A1','Main warehouse · A1')
on conflict(code) do update set name=excluded.name;
alter table wms.shipment_lines add column if not exists article_id uuid references wms.articles(id);
alter table wms.pick_task_lines add column if not exists location_id uuid references wms.locations(id);
update wms.pick_task_lines set location_id=(select id from wms.locations where code='A1') where location_id is null;
create table if not exists wms.stock_movements (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references wms.articles(id),
  location_id uuid not null references wms.locations(id),
  movement_type text not null check (movement_type in ('receipt','adjustment','pick','pick_reversal')),
  quantity_delta numeric not null check (quantity_delta <> 0),
  reference text,note text,actor_user_id uuid,created_at timestamptz not null default now()
);
create index if not exists stock_movements_article_location_idx on wms.stock_movements(article_id,location_id,created_at desc);
create index if not exists pick_task_lines_location_idx on wms.pick_task_lines(location_id);
alter table wms.articles enable row level security;
alter table wms.locations enable row level security;
alter table wms.stock_movements enable row level security;
revoke all on wms.articles,wms.locations,wms.stock_movements from anon,authenticated;
grant all on wms.articles,wms.locations,wms.stock_movements to service_role;
create or replace function wms.sync_article_from_shipment_line()
returns trigger language plpgsql set search_path = '' as $$
declare v_code text; v_id uuid;
begin
  v_code:=coalesce(nullif(trim(new.supplier_article_number),''),nullif(trim(new.buyer_article_number),''));
  if v_code is null then new.article_id:=null;return new;end if;
  insert into wms.articles(article_code,supplier_article_number,buyer_article_number,description,updated_at)
  values(v_code,nullif(trim(new.supplier_article_number),''),nullif(trim(new.buyer_article_number),''),new.description,now())
  on conflict(article_code) do update set
    supplier_article_number=coalesce(excluded.supplier_article_number,wms.articles.supplier_article_number),
    buyer_article_number=coalesce(excluded.buyer_article_number,wms.articles.buyer_article_number),
    description=coalesce(excluded.description,wms.articles.description),updated_at=now()
  returning id into v_id;
  new.article_id:=v_id;return new;
end;$$;
drop trigger if exists shipment_line_sync_article on wms.shipment_lines;
create trigger shipment_line_sync_article before insert or update of supplier_article_number,buyer_article_number,description
on wms.shipment_lines for each row execute function wms.sync_article_from_shipment_line();
update wms.shipment_lines set supplier_article_number=supplier_article_number;
create or replace function wms.default_pick_location()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.location_id is null then select id into new.location_id from wms.locations where code='A1' and is_active=true;end if;
 return new;
end;$$;
drop trigger if exists pick_task_line_default_location on wms.pick_task_lines;
create trigger pick_task_line_default_location before insert on wms.pick_task_lines
for each row execute function wms.default_pick_location();
create or replace function wms.record_pick_stock_movement()
returns trigger language plpgsql set search_path = '' as $$
declare v_article_id uuid;v_delta numeric;v_on_hand numeric;v_location_id uuid;
begin
 v_delta:=coalesce(new.quantity_picked,0)-coalesce(old.quantity_picked,0);
 if v_delta=0 then return new;end if;
 select sl.article_id into v_article_id from wms.shipment_lines sl where sl.id=new.shipment_line_id;
 if v_article_id is null then raise exception 'This order line has no article master record. Refresh the shipment before picking.';end if;
 v_location_id:=coalesce(new.location_id,old.location_id);
 select coalesce(sum(sm.quantity_delta),0) into v_on_hand from wms.stock_movements sm
 where sm.article_id=v_article_id and sm.location_id=v_location_id;
 if v_delta>0 and v_on_hand<v_delta then raise exception 'Insufficient stock at the assigned location. Record a receipt or stock adjustment before picking.';end if;
 insert into wms.stock_movements(article_id,location_id,movement_type,quantity_delta,reference,note)
 values(v_article_id,v_location_id,case when v_delta>0 then 'pick' else 'pick_reversal' end,-v_delta,
 'Pick task '||new.pick_task_id::text,case when v_delta>0 then 'Stock consumed by confirmed picking' else 'Picked quantity was reversed' end);
 return new;
end;$$;
drop trigger if exists pick_task_line_stock_movement on wms.pick_task_lines;
create trigger pick_task_line_stock_movement after update of quantity_picked on wms.pick_task_lines
for each row execute function wms.record_pick_stock_movement();
create or replace function public.list_wms_inventory()
returns jsonb language sql stable set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',a.id,'article_code',a.article_code,'supplier_article_number',a.supplier_article_number,
 'buyer_article_number',a.buyer_article_number,'description',a.description,
 'location_id',l.id,'location_code',l.code,'on_hand',coalesce(b.on_hand,0),
 'allocated',coalesce(x.allocated,0),'available',coalesce(b.on_hand,0)-coalesce(x.allocated,0)
 ) order by a.article_code),'[]'::jsonb)
 from wms.articles a cross join wms.locations l
 left join (select article_id,location_id,sum(quantity_delta) as on_hand from wms.stock_movements group by article_id,location_id) b
 on b.article_id=a.id and b.location_id=l.id
 left join (
  select sl.article_id,ptl.location_id,sum(greatest(ptl.quantity_to_pick-ptl.quantity_picked,0)) as allocated
  from wms.pick_task_lines ptl join wms.pick_tasks pt on pt.id=ptl.pick_task_id
  and pt.status in ('open'::wms.pick_task_status,'in_progress'::wms.pick_task_status)
  join wms.shipment_lines sl on sl.id=ptl.shipment_line_id group by sl.article_id,ptl.location_id
 ) x on x.article_id=a.id and x.location_id=l.id where l.is_active;
$$;
create or replace function public.list_wms_stock_movements()
returns jsonb language sql stable set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',m.id,'article_code',a.article_code,'description',a.description,'location_code',l.code,
 'movement_type',m.movement_type,'quantity_delta',m.quantity_delta,'reference',m.reference,
 'note',m.note,'created_at',m.created_at) order by m.created_at desc),'[]'::jsonb)
 from (select * from wms.stock_movements order by created_at desc limit 500) m
 join wms.articles a on a.id=m.article_id join wms.locations l on l.id=m.location_id;
$$;
create or replace function public.record_wms_stock_movement(
 p_article_code text,p_location_code text,p_quantity_delta numeric,p_movement_type text,
 p_reference text,p_note text,p_actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_article uuid;v_location uuid;v_on_hand numeric;v_id uuid;
begin
 if p_quantity_delta is null or p_quantity_delta=0 then raise exception 'Enter a non-zero stock quantity';end if;
 if p_movement_type not in ('receipt','adjustment') then raise exception 'Unsupported stock movement type';end if;
 select id into v_article from wms.articles where article_code=trim(p_article_code);
 if v_article is null then raise exception 'Article not found. Import an order containing this article first.';end if;
 select id into v_location from wms.locations where code=trim(p_location_code) and is_active=true;
 if v_location is null then raise exception 'Active warehouse location not found';end if;
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
revoke all on function public.list_wms_inventory() from public,anon,authenticated;
revoke all on function public.list_wms_stock_movements() from public,anon,authenticated;
revoke all on function public.record_wms_stock_movement(text,text,numeric,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.list_wms_inventory() to service_role;
grant execute on function public.list_wms_stock_movements() to service_role;
grant execute on function public.record_wms_stock_movement(text,text,numeric,text,text,text,uuid) to service_role;
