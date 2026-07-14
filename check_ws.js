const { createClient } = require("@supabase/supabase-js");

const insforge = createClient(
  process.env.NEXT_PUBLIC_INSFORGE_URL,
  process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
);

async function checkWorkspace() {
  // Select without where to see if anything is returned (RLS might still block)
  const { data, error } = await insforge.from("workspaces").select("*");
  console.log("Workspaces:", data, error);
}

checkWorkspace();
