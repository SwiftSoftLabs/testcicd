SET search_path TO app_meridian;

INSERT INTO app_meridian.accounts (domain, name, size, industry, hq, velocity_90d, department_mix, competitor_tools)
VALUES
  ('atlasforge.io',     'Atlasforge',         'Mid-Market', 'Industrial SaaS',     'Austin, TX',
   ARRAY[2,1,3,4,6,5,7,9,11,8,12,14],
   '{"Engineering":18,"Sales":12,"Marketing":6,"Customer Success":5,"Operations":4,"Other":3}'::jsonb,
   ARRAY['HubSpot','Zendesk','Mixpanel']),
  ('northwind.ai',      'Northwind Robotics', 'Startup',    'Robotics',            'Remote',
   ARRAY[1,2,2,3,3,4,5,6,5,7,8,6],
   '{"Engineering":22,"Operations":4,"Other":2}'::jsonb,
   ARRAY['Datadog','Grafana Cloud']),
  ('lumenhealth.com',   'Lumen Health',       'Enterprise', 'Healthcare',          'Boston, MA',
   ARRAY[6,7,5,8,9,10,8,11,12,9,13,15],
   '{"Engineering":40,"Security":12,"Operations":18,"Sales":9,"Marketing":4}'::jsonb,
   ARRAY['Vanta','Drata','OneTrust']),
  ('fairlane.co',       'Fairlane Logistics', 'Mid-Market', 'Logistics',           'Chicago, IL',
   ARRAY[3,4,5,6,8,9,11,12,14,15,18,22],
   '{"Sales":24,"Operations":12,"Customer Success":7,"Engineering":6}'::jsonb,
   ARRAY['Salesforce','ZoomInfo']),
  ('quantabio.com',     'Quanta Biosystems',  'Enterprise', 'Biotech',             'San Diego, CA',
   ARRAY[5,5,6,4,5,7,8,6,9,10,11,9],
   '{"Engineering":30,"Operations":12,"Sales":6,"Marketing":3}'::jsonb,
   ARRAY['AWS','Snowflake']),
  ('beaconcx.com',      'Beacon CX',          'Startup',    'Customer Experience', 'Remote',
   ARRAY[1,1,2,2,3,3,4,4,5,4,6,5],
   '{"Engineering":12,"Customer Success":6,"Sales":4}'::jsonb,
   ARRAY['Gainsight','Vitally']),
  ('helixledger.io',    'Helix Ledger',       'Mid-Market', 'Fintech',             'New York, NY',
   ARRAY[2,3,3,4,5,6,5,7,6,8,9,11],
   '{"Engineering":16,"Revenue Operations":4,"Sales":6,"Operations":3}'::jsonb,
   ARRAY['NetSuite','Salesforce']),
  ('cinder.studio',     'Cinder Studios',     'Startup',    'Media',               'London, UK',
   ARRAY[1,2,1,2,3,2,3,4,3,4,5,3],
   '{"Engineering":8,"Legal":2,"Operations":3}'::jsonb,
   ARRAY['Cookiebot'])
ON CONFLICT (domain) DO NOTHING;

INSERT INTO app_meridian.signals
  (account_id, job_title, department, location, posted_at, source, category, intent_score, mandate, hiring_manager, tech_keywords, reasoning)
SELECT a.id, v.job_title, v.department, v.location, v.posted_at::timestamptz, v.source, v.category, v.intent_score, v.mandate, v.hiring_manager, v.tech_keywords, v.reasoning
FROM (VALUES
  ('atlasforge.io',   'Head of RevOps',                        'Revenue Operations', 'Austin, TX',         '2026-05-08T14:00:00Z', 'LinkedIn', 'Sales Operations',         92,
   'Build the RevOps function from scratch — own CRM consolidation onto Salesforce, integrate Outreach + Gong, design forecasting cadence.',
   '{"name":"Priya Mehta","title":"CRO","email":"priya@atlasforge.io"}'::jsonb,
   ARRAY['Salesforce','Outreach','Gong','Looker'],
   'First RevOps hire + named CRM migration = active stack re-evaluation. Window: 60-90 days before vendor selection.'),
  ('northwind.ai',    'Senior Site Reliability Engineer',      'Infrastructure',     'Remote (US)',        '2026-05-09T09:30:00Z', 'Wellfound','Infrastructure Expansion', 78,
   'Scale Kubernetes footprint across multi-region GKE, introduce SLOs, evaluate observability stack (Datadog vs. Honeycomb vs. Grafana Cloud).',
   NULL,
   ARRAY['Kubernetes','GKE','Datadog','Honeycomb','Terraform'],
   'Explicit observability bake-off mentioned in JD — vendor selection actively underway.'),
  ('lumenhealth.com', 'Director of Information Security',      'Security',           'Boston, MA',         '2026-05-07T18:15:00Z', 'LinkedIn', 'Compliance & Risk',        88,
   'Drive HITRUST + SOC 2 Type II readiness, stand up vendor risk program, own GRC tooling selection.',
   '{"name":"Marcus Chen","title":"CISO"}'::jsonb,
   ARRAY['SOC2','HITRUST','GRC','Vanta','Drata'],
   'Greenfield GRC program at an enterprise — high-ticket security tooling budget allocated.'),
  ('fairlane.co',     'VP of Sales',                            'Sales',              'Chicago, IL',        '2026-05-09T16:45:00Z', 'Indeed',   'Growth Mode',              81,
   'Scale sales org from 12 → 40 reps in 9 months, build outbound motion, own pipeline gen targets.',
   NULL,
   ARRAY['Salesforce','Outreach','ZoomInfo','6sense'],
   'Headcount tripling implies new tooling for prospecting, intent, and enablement.'),
  ('quantabio.com',   'Senior Cloud Architect — AWS',          'Infrastructure',     'San Diego, CA',      '2026-05-06T11:00:00Z', 'Dice',     'Infrastructure Expansion', 74,
   'Lead lift-and-shift of on-prem analytics workloads to AWS, design landing zone, evaluate FinOps tooling.',
   NULL,
   ARRAY['AWS','Terraform','Snowflake','CloudHealth'],
   'Active migration project with FinOps tooling requirement explicitly named.'),
  ('beaconcx.com',    'Customer Success Manager (Enterprise)', 'Customer Success',   'Remote (US)',        '2026-05-10T08:00:00Z', 'Built In', 'Growth Mode',              66,
   'First enterprise CSM hire — own onboarding playbooks, QBR cadence, expansion motion.',
   NULL,
   ARRAY['Gainsight','Catalyst','Vitally'],
   'First enterprise CSM signals a new motion — CS platform decision likely within 90 days.'),
  ('helixledger.io',  'Salesforce Administrator',              'Revenue Operations', 'New York, NY',       '2026-05-05T13:30:00Z', 'LinkedIn', 'Sales Operations',         71,
   'Own day-to-day Salesforce admin, integrate billing system, support implementation of CPQ.',
   NULL,
   ARRAY['Salesforce','CPQ','NetSuite'],
   'CPQ implementation mention = active quote-to-cash tooling project.'),
  ('cinder.studio',   'GDPR Privacy Counsel (Contract)',       'Legal',              'London, UK',         '2026-05-04T10:00:00Z', 'LinkedIn', 'Compliance & Risk',        63,
   'Stand up DPO function, complete RoPA, evaluate consent management platforms.',
   NULL,
   ARRAY['GDPR','OneTrust','Cookiebot'],
   'Greenfield privacy program at a EU-regulated startup — CMP selection imminent.')
) AS v(account_domain, job_title, department, location, posted_at, source, category, intent_score, mandate, hiring_manager, tech_keywords, reasoning)
JOIN app_meridian.accounts a ON a.domain = v.account_domain
WHERE NOT EXISTS (
  SELECT 1 FROM app_meridian.signals s
  WHERE s.account_id = a.id AND s.job_title = v.job_title
);
