const { createClient } = require("@supabase/supabase-js");

const insforge = createClient(
  process.env.NEXT_PUBLIC_INSFORGE_URL,
  process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
);

async function check() {
  const { data, error } = await insforge.rpc("get_policies"); // This might not exist
  // Instead let's just try to select and see if it fails
  const { data: ws, error: err } = await insforge
    .from("workspace_members")
    .select("*")
    .limit(1);
  if (err) {
    console.log("Error still exists:", err.message);
  } else {
    console.log("Query successful! No more recursion.");
    console.log("Data:", ws);
  }
}

check();
