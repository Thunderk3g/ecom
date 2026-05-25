CREATE TYPE "public"."order_fulfillment_status" AS ENUM('unfulfilled', 'partial', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."address_type" AS ENUM('billing', 'shipping', 'both');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('pending', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'dispatched');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('active', 'paused');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'completed';--> statement-breakpoint
CREATE TABLE "fulfillment_items" (
	"fulfillment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "fulfillment_items_fulfillment_id_order_item_id_pk" PRIMARY KEY("fulfillment_id","order_item_id")
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "fulfillment_status" DEFAULT 'pending' NOT NULL,
	"tracking_number" text,
	"carrier" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"shipment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "shipment_items_shipment_id_order_item_id_pk" PRIMARY KEY("shipment_id","order_item_id")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"label_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_items" (
	"refund_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "refund_items_refund_id_order_item_id_pk" PRIMARY KEY("refund_id","order_item_id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"response_code" integer,
	"body" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_try_at" timestamp with time zone,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"status" "webhook_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_intents" DROP CONSTRAINT "payment_intents_cart_id_carts_id_fk";
--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "type" SET DATA TYPE "public"."address_type" USING "type"::"public"."address_type";--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "cart_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "accepts_marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lifetime_value_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_status" "order_fulfillment_status" DEFAULT 'unfulfilled' NOT NULL;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_fulfillment_id_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillments_order_idx" ON "fulfillments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fulfillments_store_status_idx" ON "fulfillments" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_store_status_idx" ON "refunds" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "audit_log_store_entity_idx" ON "audit_log" USING btree ("store_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_store_created_idx" ON "audit_log" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_events_store_kind_idx" ON "order_events" USING btree ("store_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_store_status_idx" ON "outbox_events" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id","status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_next_try_idx" ON "webhook_deliveries" USING btree ("next_try_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhooks_store_status_idx" ON "webhooks" USING btree ("store_id","status");--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_customer_idx" ON "addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_store_user_uq" ON "customers" USING btree ("store_id","user_id") WHERE "customers"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_store_guest_email_uq" ON "customers" USING btree ("store_id","email") WHERE "customers"."user_id" IS NULL;--> statement-breakpoint
CREATE INDEX "customers_store_email_idx" ON "customers" USING btree ("store_id","email");