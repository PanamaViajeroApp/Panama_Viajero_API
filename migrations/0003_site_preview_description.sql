ALTER TABLE sites
ADD COLUMN preview_description TEXT NOT NULL DEFAULT '';

UPDATE sites
SET preview_description = description
WHERE preview_description = '';
