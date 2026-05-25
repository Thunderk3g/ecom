CREATE TYPE "public"."asset_kind" AS ENUM('image', 'svg', 'doc');--> statement-breakpoint
CREATE TABLE "asset_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"width" integer,
	"height" integer,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_tags" (
	"asset_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "asset_tags_asset_id_tag_pk" PRIMARY KEY("asset_id","tag")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"checksum" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_derivatives" ADD CONSTRAINT "asset_derivatives_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tags" ADD CONSTRAINT "asset_tags_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_derivatives_asset_preset_idx" ON "asset_derivatives" USING btree ("asset_id","preset");--> statement-breakpoint
CREATE INDEX "assets_store_key_idx" ON "assets" USING btree ("store_id","key");--> statement-breakpoint
CREATE INDEX "assets_store_kind_idx" ON "assets" USING btree ("store_id","kind","created_at" DESC NULLS LAST);
