const { createClient } = require("@supabase/supabase-js");

const url = "https://dxnhjs86.us-east.insforge.app";
const key =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMjc1NDN9.qWID9SFAU0o4x-tITLSFMklNaPaMokb5TNXu6cNyJqU";

const insforge = createClient(url, key);

async function test() {
  console.log("Testing signup...");
  try {
    const { data, error } = await insforge.auth.signUp({
      email: `test_${Date.now()}@example.com`,
      password: "password123",
      options: {
        data: {
          app_origin: "app_onework",
        },
      },
    });
    if (error) {
      console.error("Signup failed:", error);
    } else {
      console.log("Signup success:", data);
    }
  } catch (e) {
    console.error("Signup crashed:", e);
  }
}

test();
