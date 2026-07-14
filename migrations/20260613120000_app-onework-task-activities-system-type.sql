-- Allow system activity rows (status changes, project moves) from logTaskSystemActivity.

ALTER TABLE app_onework.task_activities
  DROP CONSTRAINT IF EXISTS task_activities_type_check;

ALTER TABLE app_onework.task_activities
  ADD CONSTRAINT task_activities_type_check CHECK (
    type = ANY (
      ARRAY[
        'comment'::text,
        'comment_image'::text,
        'status_change'::text,
        'assignment'::text,
        'create'::text,
        'system'::text
      ]
    )
  );
