-- Add image_zoom to products table
-- Stores the zoom level (percentage 50–200) set in backoffice for each product image
alter table products
  add column if not exists image_zoom integer not null default 100;
