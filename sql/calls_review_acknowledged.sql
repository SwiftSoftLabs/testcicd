-- Allow in-call acknowledgement before final approval from the Review tab.
ALTER TABLE app_onework.meeting_task_reviews
  DROP CONSTRAINT IF EXISTS meeting_task_reviews_review_status_check;

ALTER TABLE app_onework.meeting_task_reviews
  ADD CONSTRAINT meeting_task_reviews_review_status_check
  CHECK (review_status IN ('pending', 'acknowledged', 'approved', 'rejected'));
