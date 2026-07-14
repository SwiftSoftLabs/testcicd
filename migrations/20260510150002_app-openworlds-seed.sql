INSERT INTO app_openworlds.world_models
  (id, name, company, utility, output_modality, interactivity_level, latency_target, best_for, color, outputs, sort_order)
VALUES
  ('happy-oyster', 'Happy Oyster', 'Alibaba ATH', 'Open-ended world wandering', 'Real-time interactive video', 'Continuous response', '480p/720p stream', 'Directing mode and first-person exploration', '#14b8a6', ARRAY['WASD wandering','Camera directing','3 min coherent stream'], 1),
  ('echo-2', 'SpAItial AI Echo-2', 'SpAItial AI', 'Unified 3D scene representation', 'Interactive 3DGS world', 'Object-level edits', 'Browser-native splats', 'Semantic staging and digital twinning', '#f97316', ARRAY['Wall/floor segmentation','Object swap graph','Editable 3DGS'], 2),
  ('hy-world', 'HY-World 2.0', 'Tencent', 'Production-ready asset creation', '3DGS, mesh, point cloud', 'Export-ready', 'Four-stage pipeline', 'Unity, Unreal, Blender handoff', '#2563eb', ARRAY['HY-Pano','WorldNav','WorldStereo','WorldMirror'], 3),
  ('oasis', 'Decart Oasis', 'Decart', 'Physics-driven simulation', 'Action-conditional video', 'Gameplay rules', '< 0.04s per frame', 'Playable world mechanics', '#dc2626', ARRAY['Inventory rules','Collision signals','Action-conditioned frames'], 4),
  ('luma-genie', 'Luma Genie', 'Luma AI', 'Procedural asset prototyping', 'Refined PBR 3D models', 'Asset-centric iteration', '~10s preview set', 'Furniture and prop generation', '#ca8a04', ARRAY['4 rapid previews','PBR refinement','Quad mesh topology'], 5),
  ('nwm', 'NWM / Pathdreamer', 'Navigation world model', 'Interior navigation prediction', '360-degree synthesized views', 'Navigation-aware', 'Predictive trajectories', 'Incomplete scans and mobile continuity', '#7c3aed', ARRAY['Imagined corners','360 view synthesis','Egocentric path memory'], 6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  company = EXCLUDED.company,
  utility = EXCLUDED.utility,
  output_modality = EXCLUDED.output_modality,
  interactivity_level = EXCLUDED.interactivity_level,
  latency_target = EXCLUDED.latency_target,
  best_for = EXCLUDED.best_for,
  color = EXCLUDED.color,
  outputs = EXCLUDED.outputs,
  sort_order = EXCLUDED.sort_order;

INSERT INTO app_openworlds.workflow_steps (slug, label, description, sort_order)
VALUES
  ('capture', 'Capture source media', 'Upload images, video, floor plans, or raw splat/mesh assets.', 1),
  ('generate', 'Generate spatial base', 'Route prompts and source media through the selected spatial model.', 2),
  ('stage', 'Stage and decompose', 'Apply semantic staging, object swaps, and scene decomposition.', 3),
  ('optimize', 'Optimize SOG delivery', 'Compress and stream the generated world for mobile browsers.', 4),
  ('publish', 'Publish guided tour', 'Create buyer, game, or production links with annotations.', 5)
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO app_openworlds.staging_styles (slug, name, prompt_hint, sort_order)
VALUES
  ('scandinavian', 'Scandinavian', 'Light wood, clean lines, soft white textiles.', 1),
  ('warm-modern', 'Warm Modern', 'Textured neutrals, brass accents, warm light.', 2),
  ('japandi', 'Japandi', 'Minimal furniture, natural fibers, balanced negative space.', 3),
  ('industrial', 'Industrial', 'Dark metal, exposed materials, loft lighting.', 4),
  ('coastal', 'Coastal', 'Airy palette, linen, sea-glass accents.', 5)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, prompt_hint = EXCLUDED.prompt_hint, sort_order = EXCLUDED.sort_order;

INSERT INTO app_openworlds.environment_presets (slug, name, prompt_hint, sort_order)
VALUES
  ('clear', 'Clear', 'Neutral daylight with clean visibility.', 1),
  ('golden-hour', 'Golden hour', 'Warm sunset light and soft shadows.', 2),
  ('rain', 'Rain', 'Wet exterior reflections and overcast interior light.', 3),
  ('night', 'Night', 'Evening view with practical interior lighting.', 4),
  ('snow', 'Snow', 'Snow-covered exterior context and cool daylight.', 5)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, prompt_hint = EXCLUDED.prompt_hint, sort_order = EXCLUDED.sort_order;

INSERT INTO app_openworlds.semantic_nodes (slug, label, color, model_id, sort_order)
VALUES
  ('walls', 'Walls', '#14b8a6', 'echo-2', 1),
  ('floors', 'Floors', '#f97316', 'echo-2', 2),
  ('ceiling', 'Ceiling', '#14b8a6', 'echo-2', 3),
  ('sofa', 'Sofa', '#f97316', 'echo-2', 4),
  ('table', 'Table', '#14b8a6', 'echo-2', 5),
  ('lighting', 'Lighting', '#f97316', 'echo-2', 6)
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, color = EXCLUDED.color, model_id = EXCLUDED.model_id, sort_order = EXCLUDED.sort_order;

INSERT INTO app_openworlds.export_targets (slug, name, format, description, sort_order)
VALUES
  ('playcanvas-sog', 'PlayCanvas SOG', 'sog', 'Compressed Spatially Ordered Gaussians for browser delivery.', 1),
  ('unity-3dgs', 'Unity 3DGS', '3dgs', 'Gaussian scene package for Unity runtime use.', 2),
  ('unreal-mesh', 'Unreal mesh', 'obj', 'Mesh and material export for Unreal Engine.', 3),
  ('blender-obj', 'Blender OBJ', 'obj', 'Editable object export for Blender.', 4)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, format = EXCLUDED.format, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO app_openworlds.trust_signals (slug, label, value, description, sort_order)
VALUES
  ('floor-plan', 'Verified floor plan', 'Verified floor plan', 'Floor plan dimensions are linked to the generated world.', 1),
  ('bias-audit', 'Bias audit queued', 'Bias audit queued', 'AVM output is flagged for non-discrimination review.', 2),
  ('sources', 'Data sources clear', 'Data sources clear', 'Ground-truth and AI-generated surfaces are disclosed separately.', 3)
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, value = EXCLUDED.value, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO app_openworlds.world_sessions
  (id, title, mode, active_engine_id, prompt, furnishing_style, environment, source_files, progress, active_step, is_public, status)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'Vacant condo digital twin',
    'real-estate',
    'happy-oyster',
    'Convert five vacant condo photos into a bright, walkable digital twin with verified room scale.',
    'Scandinavian',
    'Golden hour',
    ARRAY['living-room.jpg','kitchen.jpg','hallway.jpg'],
    68,
    2,
    true,
    'generating'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  mode = EXCLUDED.mode,
  active_engine_id = EXCLUDED.active_engine_id,
  prompt = EXCLUDED.prompt,
  furnishing_style = EXCLUDED.furnishing_style,
  environment = EXCLUDED.environment,
  source_files = EXCLUDED.source_files,
  progress = EXCLUDED.progress,
  active_step = EXCLUDED.active_step,
  is_public = EXCLUDED.is_public,
  status = EXCLUDED.status;
