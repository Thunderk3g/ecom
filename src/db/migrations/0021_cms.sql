CREATE TYPE "public"."content_page_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."navigation_slot" AS ENUM('header', 'footer', 'mobile');--> statement-breakpoint
CREATE TABLE "content_blocks_lib" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"schema" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" "content_page_status" DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"draft_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "navigation_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"slot" "navigation_slot" NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_blocks_lib" ADD CONSTRAINT "content_blocks_lib_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_page_id_content_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."content_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "navigation_menus" ADD CONSTRAINT "navigation_menus_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_blocks_lib_store_key_uq" ON "content_blocks_lib" USING btree ("store_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pages_store_slug_uq" ON "content_pages" USING btree ("store_id","slug");--> statement-breakpoint
CREATE INDEX "content_pages_status_idx" ON "content_pages" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "content_versions_page_idx" ON "content_versions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "navigation_menus_store_slot_uq" ON "navigation_menus" USING btree ("store_id","slot");