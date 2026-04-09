-- Add tags array column to members for custom labeling/segmentation
ALTER TABLE members ADD COLUMN tags TEXT[] DEFAULT '{}';
