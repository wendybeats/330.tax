import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.session) {
      // Store the Google provider token so we can use it for Gmail API later
      const providerToken = data.session.provider_token
      const providerRefreshToken = data.session.provider_refresh_token

      if (providerToken) {
        // Upsert user record with Google tokens
        await supabase.from("users").upsert(
          {
            id: data.session.user.id,
            email: data.session.user.email || "",
            google_refresh_token: providerRefreshToken || null,
          },
          { onConflict: "id" }
        )
      }

      return NextResponse.redirect(`${origin}/onboard`)
    }
  }

  return NextResponse.redirect(`${origin}/login`)
}
