-- Preflight: run this SELECT first to check for duplicates before applying.
-- If it returns rows, resolve them before proceeding.
--
-- SELECT lower(email) AS email, COUNT(*) AS count
-- FROM app_onework.profiles
-- GROUP BY lower(email)
-- HAVING COUNT(*) > 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM app_onework.profiles
        GROUP BY lower(email)
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot add profiles_email_unique: duplicate profile emails exist. Run the preflight SELECT above to identify them.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_email_unique'
          AND conrelid = 'app_onework.profiles'::regclass
    ) THEN
        ALTER TABLE app_onework.profiles
            ADD CONSTRAINT profiles_email_unique UNIQUE (email);
    END IF;
END $$;
