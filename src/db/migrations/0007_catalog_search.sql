-- Postgres FTS + pg_trgm search for catalog.products.
-- search_tsv is maintained by trigger from name (A), brand (B), description_md (C), attributes (D).
-- A GIN index on search_tsv powers @@ queries; a gin_trgm_ops index on name powers typo-tolerant similarity.

-- Extensions. Superuser-only — runs as app_migrator (which has CREATEROLE/owner privileges in dev).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- tsvector column (nullable; trigger populates on every INSERT/UPDATE)
ALTER TABLE products ADD COLUMN search_tsv tsvector;

-- Trigger function: weighted tsvector from name/brand/description_md/attributes.
-- unaccent() normalizes diacritics so "café" matches "cafe".
-- Attribute values are flattened to a space-separated string via jsonb_each_text.
CREATE OR REPLACE FUNCTION products_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.brand, ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.description_md, ''))), 'C') ||
    setweight(
      to_tsvector(
        'simple',
        unaccent(coalesce(
          (SELECT string_agg(value::text, ' ')
             FROM jsonb_each_text(NEW.attributes)),
          ''
        ))
      ),
      'D'
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_search_tsv_trg
  BEFORE INSERT OR UPDATE OF name, brand, description_md, attributes
  ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_tsv_update();

-- Indexes. The tsvector GIN powers full-text matching; the trgm GIN on name powers typo tolerance.
CREATE INDEX products_search_tsv_gin ON products USING gin (search_tsv);
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);

-- Backfill any existing rows (no-op on a fresh DB; matters when re-running on an existing dataset).
UPDATE products SET name = name;
