GRANT USAGE ON SCHEMA app_jobwiseai TO PUBLIC;

GRANT SELECT ON app_jobwiseai.tools                     TO PUBLIC;

GRANT SELECT ON app_jobwiseai.reviews                   TO PUBLIC;

GRANT SELECT ON app_jobwiseai.stat_metrics              TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_jobwiseai.user_profiles          TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_jobwiseai.saved_tools            TO PUBLIC;

GRANT SELECT, INSERT ON app_jobwiseai.quiz_results                           TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_jobwiseai.vendor_profiles        TO PUBLIC;

GRANT SELECT ON app_jobwiseai.subscriptions                                  TO PUBLIC;

GRANT INSERT ON app_jobwiseai.reviews                                        TO PUBLIC;

GRANT SELECT, INSERT ON app_jobwiseai.vendor_analytics_events                TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_jobwiseai.coupons                TO PUBLIC;

GRANT SELECT, INSERT ON app_jobwiseai.admin_audit_log                        TO PUBLIC;
