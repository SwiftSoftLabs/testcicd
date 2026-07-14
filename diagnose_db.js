const { createClient } = require("@supabase/supabase-js");

const insforge = createClient(
  process.env.NEXT_PUBLIC_INSFORGE_URL,
  process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
);

async function check() {
  const tables = [
    "profiles",
    "workspaces",
    "workspace_members",
    "projects",
    "tasks",
    "conversations",
    "messages",
    "emails",
    "commits",
    "pull_requests",
    "notifications",
  ];
  for (const table of tables) {
    try {
      const { error } = await insforge.from(table).select("id").limit(1);
      if (error) {
        console.log(`[ABSENT] ${table}: ${error.message}`);
      } else {
        console.log(`[PRESENT] ${table}`);
      }
    } catch (e) {
      console.log(`[CRASH] ${table}: ${e.message}`);
    }
  }
}

check();
