INSERT INTO app_postdose.recipes (id, title, description, phase, protein_g, calories, tag) VALUES
  ('bone-broth', 'Warm Bone Broth', 'Easy on the stomach, rich in amino acids for recovery.', 'peak', 8, 45, 'High Protein'),
  ('ginger-tea', 'Fresh Ginger Tea', 'Natural gingerol to soothe gastrointestinal distress.', 'peak', 0, 5, 'Anti-Nausea'),
  ('greek-yogurt', 'Chilled Greek Yogurt', 'Cold protein source, gentle on nausea.', 'peak', 25, 150, 'High Protein'),
  ('salmon-bowl', 'Salmon Power Bowl', 'Fiber-rich greens with omega-3 protein.', 'adjustment', 35, 420, 'Nutrient Dense'),
  ('quinoa-stirfry', 'Quinoa Stir Fry', 'Complex carbs and lean protein for energy loading.', 'adjustment', 28, 380, 'Fiber Rich'),
  ('cauliflower-rice', 'Cauliflower Rice Stir Fry', 'High-volume, low-calorie satiety meal.', 'tailing', 30, 320, 'Volume Meal'),
  ('veggie-soup', 'Vegetable Buffer Soup', 'Blunts hunger signals with fiber volume.', 'tailing', 12, 180, 'Low Calorie')
ON CONFLICT (id) DO NOTHING;
