const { createClient } = require("@supabase/supabase-js");

const insforge = createClient(
  process.env.NEXT_PUBLIC_INSFORGE_URL,
  process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
);

async function checkTasks() {
  const { data, error } = await insforge
    .from("tasks")
    .select("id, title, workspace_id")
    .limit(5);
  if (error) {
    console.error("Error fetching tasks:", error.message);
  } else {
    console.log("Tasks in DB:", data);
  }
}

checkTasks();
