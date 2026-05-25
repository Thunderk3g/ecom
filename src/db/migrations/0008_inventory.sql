CREATE TYPE "public"."location_type" AS ENUM('warehouse', 'store', 'transit');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('inbound', 'outbound', 'adjustment', 'reservation', 'release', 'transfer_out', 'transfer_in');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('draft', 'placed', 'partial', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'committed', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "location_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"po_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty_ordered" integer NOT NULL,
	"qty_received" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer NOT NULL,
	CONSTRAINT "purchase_order_items_po_id_variant_id_pk" PRIMARY KEY("po_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "po_status" DEFAULT 'draft' NOT NULL,
	"placed_at" timestamp with time zone,
	"expected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"batch_code" text NOT NULL,
	"qty" integer NOT NULL,
	"expiry_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_variant_id_location_id_pk" PRIMARY KEY("variant_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"reason" text,
	"ref_type" text,
	"ref_id" uuid,
	"batch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"cart_id" uuid,
	"order_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_thresholds" (
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"reorder_point" integer NOT NULL,
	"reorder_qty" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_thresholds_variant_id_location_id_pk" PRIMARY KEY("variant_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_skus" (
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"supplier_sku" text NOT NULL,
	"cost_cents" integer NOT NULL,
	"moq" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_skus_supplier_id_variant_id_pk" PRIMARY KEY("supplier_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact" jsonb,
	"lead_time_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_inventory_settings" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"batch_tracked" boolean DEFAULT false NOT NULL,
	"allow_backorder" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_skus" ADD CONSTRAINT "supplier_skus_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_skus" ADD CONSTRAINT "supplier_skus_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_skus" ADD CONSTRAINT "supplier_skus_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_inventory_settings" ADD CONSTRAINT "variant_inventory_settings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_inventory_settings" ADD CONSTRAINT "variant_inventory_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_store_code_uq" ON "locations" USING btree ("store_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_variant_code_uq" ON "stock_batches" USING btree ("variant_id","location_id","batch_code");--> statement-breakpoint
CREATE INDEX "movements_variant_idx" ON "stock_movements" USING btree ("variant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "movements_ref_idx" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "reservations_cart_idx" ON "stock_reservations" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "reservations_active_expires_idx" ON "stock_reservations" USING btree ("expires_at") WHERE status = 'active';