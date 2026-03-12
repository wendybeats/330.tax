import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TaxProfile, User } from "@/types/database";
import { TaxProfileForm } from "@/components/settings/tax-profile-form";
import { ConnectedAccounts } from "@/components/settings/connected-accounts";
import { DataManagement } from "@/components/settings/data-management";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const { data: dbUser } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  const { data: taxProfile } = await supabase
    .from("tax_profiles")
    .select("*")
    .eq("user_id", authUser.id)
    .order("tax_year", { ascending: false })
    .limit(1)
    .single();

  const userRecord = dbUser as User | null;
  const profile = taxProfile as TaxProfile | null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your account, tax profile, and data.
        </p>
      </div>

      {/* Connected Accounts */}
      <ConnectedAccounts
        email={authUser.email ?? ""}
        hasGoogleToken={!!userRecord?.google_refresh_token}
      />

      {/* Tax Profile */}
      <TaxProfileForm profile={profile} userId={authUser.id} />

      {/* Data Management */}
      <DataManagement />
    </div>
  );
}
