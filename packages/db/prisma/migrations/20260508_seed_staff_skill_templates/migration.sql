-- Seeds two starter staff-skills audit templates: Barista and Kitchen Crew.
-- Run AFTER 20260508_audit_staff_skills (which adds the auditTarget +
-- jobRoleFilter columns).
--
-- Both templates use ratingType = 'rating_5' (better trend signal than
-- pass/fail) and photoRequired = TRUE on every item — managers audit by
-- looking at a photo of the staff's actual work. Items are kept to a tight
-- set of photo-evidencable skills per role (5-7 items, single section).
--
-- jobRoleFilter values match the existing strings in hr_employee_profiles
-- ('Barista' and 'Kitchen Crew'). roleType is the auditor's role
-- (barista_head audits baristas, chef_head audits kitchen).
--
-- Idempotent: skips re-insert if a template with the same name already
-- exists. Safe to run twice. Lookup needs at least one OWNER (or fallback
-- ADMIN/any user) to attribute createdBy.

DO $$
DECLARE
  v_creator_id TEXT;
  v_barista_template_id TEXT;
  v_kitchen_template_id TEXT;
  v_section_id TEXT;
BEGIN
  SELECT id INTO v_creator_id FROM "User" WHERE role = 'OWNER' LIMIT 1;
  IF v_creator_id IS NULL THEN
    SELECT id INTO v_creator_id FROM "User" WHERE role = 'ADMIN' LIMIT 1;
  END IF;
  IF v_creator_id IS NULL THEN
    SELECT id INTO v_creator_id FROM "User" LIMIT 1;
  END IF;
  IF v_creator_id IS NULL THEN
    RAISE NOTICE 'No users found, skipping staff-skill template seed.';
    RETURN;
  END IF;

  -- ─── Barista Skills (6 photo-driven items) ────────────────────
  SELECT id INTO v_barista_template_id FROM "AuditTemplate"
    WHERE name = 'Barista Skills' AND "auditTarget" = 'STAFF' LIMIT 1;
  IF v_barista_template_id IS NULL THEN
    v_barista_template_id := gen_random_uuid()::text;
    INSERT INTO "AuditTemplate" (id, name, description, "roleType", "auditTarget", "jobRoleFilter", "isActive", version, "createdById", "createdAt", "updatedAt")
    VALUES (
      v_barista_template_id,
      'Barista Skills',
      'Photo-evidenced bar skills — latte art, presentation, crema, garnish, portioning, cleanliness.',
      'barista_head', 'STAFF', 'Barista', TRUE, 1, v_creator_id, NOW(), NOW()
    );
    v_section_id := gen_random_uuid()::text;
    INSERT INTO "AuditSection" (id, "templateId", name, "sortOrder")
      VALUES (v_section_id, v_barista_template_id, 'Skills', 0);
    INSERT INTO "AuditSectionItem" (id, "sectionId", title, description, "photoRequired", "ratingType", "sortOrder") VALUES
      (gen_random_uuid()::text, v_section_id, 'Latte art',          'Defined pattern, centred, good contrast',                       TRUE, 'rating_5', 0),
      (gen_random_uuid()::text, v_section_id, 'Drink presentation', 'Clean cup, correct vessel, no drips, on saucer',                TRUE, 'rating_5', 1),
      (gen_random_uuid()::text, v_section_id, 'Crema quality',      'Espresso shot — golden, even, persistent crema',                TRUE, 'rating_5', 2),
      (gen_random_uuid()::text, v_section_id, 'Garnish accuracy',   'Correct garnish per spec, fresh, well-placed',                  TRUE, 'rating_5', 3),
      (gen_random_uuid()::text, v_section_id, 'Portioning',         'Fill line correct, milk-to-espresso ratio matches recipe',      TRUE, 'rating_5', 4),
      (gen_random_uuid()::text, v_section_id, 'Cup cleanliness',    'No fingerprints, smudges, or residue on cup or saucer',         TRUE, 'rating_5', 5);
  END IF;

  -- ─── Kitchen Crew Skills (7 photo-driven items) ───────────────
  SELECT id INTO v_kitchen_template_id FROM "AuditTemplate"
    WHERE name = 'Kitchen Crew Skills' AND "auditTarget" = 'STAFF' LIMIT 1;
  IF v_kitchen_template_id IS NULL THEN
    v_kitchen_template_id := gen_random_uuid()::text;
    INSERT INTO "AuditTemplate" (id, name, description, "roleType", "auditTarget", "jobRoleFilter", "isActive", version, "createdById", "createdAt", "updatedAt")
    VALUES (
      v_kitchen_template_id,
      'Kitchen Crew Skills',
      'Photo-evidenced kitchen skills — plating, portioning, doneness, garnish, cleanliness, knife work, consistency.',
      'chef_head', 'STAFF', 'Kitchen Crew', TRUE, 1, v_creator_id, NOW(), NOW()
    );
    v_section_id := gen_random_uuid()::text;
    INSERT INTO "AuditSection" (id, "templateId", name, "sortOrder")
      VALUES (v_section_id, v_kitchen_template_id, 'Skills', 0);
    INSERT INTO "AuditSectionItem" (id, "sectionId", title, description, "photoRequired", "ratingType", "sortOrder") VALUES
      (gen_random_uuid()::text, v_section_id, 'Plating accuracy',  'Looks like the menu photo — components in right place',         TRUE, 'rating_5', 0),
      (gen_random_uuid()::text, v_section_id, 'Portioning',        'Correct portion size matches spec',                              TRUE, 'rating_5', 1),
      (gen_random_uuid()::text, v_section_id, 'Doneness / colour', 'Protein cooked correctly, colour looks right',                  TRUE, 'rating_5', 2),
      (gen_random_uuid()::text, v_section_id, 'Garnish placement', 'Correct garnish, fresh, well-placed',                            TRUE, 'rating_5', 3),
      (gen_random_uuid()::text, v_section_id, 'Plate cleanliness', 'No drips, smudges, or fingerprints on the rim',                 TRUE, 'rating_5', 4),
      (gen_random_uuid()::text, v_section_id, 'Knife uniformity',  'Cuts are consistent in size and shape',                         TRUE, 'rating_5', 5),
      (gen_random_uuid()::text, v_section_id, 'Consistency',       'Same dish looks the same across orders',                         TRUE, 'rating_5', 6);
  END IF;
END $$;
