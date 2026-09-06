// Same public values the Rust side already embeds (commands/mod.rs) and the
// site ships in its own JS. The anon key is designed to be public — it is
// protected by RLS, not by secrecy — so duplicating it here is the intended
// usage, not a leak. Only the service_role key would be a real secret, and
// it never appears in the app.
export const SUPABASE_URL = "https://cihuwuiyziarnghethbi.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHV3dWl5emlhcm5naGV0aGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjM3OTQsImV4cCI6MjEwMzYzOTc5NH0.AkAe00Vzu4506nHSjh2bl99x5hZUSejZRm3pJwVuGtI";
