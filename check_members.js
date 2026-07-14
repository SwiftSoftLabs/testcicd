const { createClient } = require("@supabase/supabase-js");

const insforge = createClient(
  process.env.NEXT_PUBLIC_INSFORGE_URL,
  process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
);

async function checkMembers() {
  const {
    data: { user },
  } = await insforge.auth.getUser(); // This won't work in node without auth flow
  // I can't check auth.uid() from node easily unless I login.
  // However, I can check all memberships.
  const { data, error } = await insforge.from("workspace_members").select("*");
  if (error) {
    console.error("Error fetching members:", error.message);
  } else {
    console.log("Memberships in DB:", data);
  }
}

checkMembers();
