create index if not exists shipment_lines_article_id_idx on wms.shipment_lines(article_id);
create index if not exists stock_movements_location_id_idx on wms.stock_movements(location_id,created_at desc);
