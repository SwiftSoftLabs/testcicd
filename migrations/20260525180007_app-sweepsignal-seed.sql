INSERT INTO app_sweepsignal.projects (id, name, address, latitude, longitude, readiness_score)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Sector 7 Industrial', '4402 Commerce Way, Docking Zone B', 37.7749, -122.4194, 82),
  ('22222222-2222-2222-2222-222222222222', 'Apex Logistics Hub', '1200 Harbor Blvd, Bay 4', 37.7849, -122.4094, 65),
  ('33333333-3333-3333-3333-333333333333', 'Vault-Tech Labs', '88 Innovation Dr, Wing C', 37.7649, -122.4294, 45)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_sweepsignal.job_orders (id, project_id, status, current_phase, scheduled_at, distance_miles)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'ready', 'light_clean', NOW() + INTERVAL '1 hour', 1.2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'scheduled', 'rough_clean', NOW() + INTERVAL '3 hours', 4.5),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'scheduled', 'rough_clean', NOW() + INTERVAL '5 hours', 8.2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_sweepsignal.checklist_items (job_order_id, zone_name, task_description, phase, requires_photo, is_completed, completed_by, sort_order, how_to)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Level 1 Kitchen', 'Deep clean interior of all cabinetry', 'light_clean', false, true, 'J. Doe', 1, 'Use non-abrasive cleaner on matte finishes.'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Level 1 Kitchen', 'Remove grout haze from tile surfaces', 'light_clean', true, false, null, 2, 'Apply grout haze remover; rinse within 5 minutes.'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Level 1 Kitchen', 'Sanitize all fixtures and handles', 'light_clean', true, false, null, 3, 'Use EPA-approved sanitizer on high-touch surfaces.')
ON CONFLICT DO NOTHING;
