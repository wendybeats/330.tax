import { redirect } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { LayoutDashboard, Map, Download, Settings } from "lucide-react"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/timeline", label: "Timeline", icon: Map },
  { href: "/export", label: "Export", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings },
]

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const email = user.email ?? ""
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined
  const initials = email
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top navigation */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          {/* Logo + nav links */}
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="text-lg font-bold tracking-tight"
            >
              330.tax
            </Link>

            <Separator orientation="vertical" className="hidden h-6 sm:block" />

            <nav className="hidden items-center gap-1 sm:flex">
              {navItems.map((item) => (
                <Button
                  key={item.href}
                  variant="ghost"
                  size="sm"
                  render={<Link href={item.href} />}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Button>
              ))}
            </nav>
          </div>

          {/* User section */}
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground lg:inline">
              {email}
            </span>
            <Avatar size="sm">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={email} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="flex items-center justify-around border-t px-2 py-1 sm:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  )
}
