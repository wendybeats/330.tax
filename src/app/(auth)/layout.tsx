export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">330.tax</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Foreign earned income exclusion, simplified
        </p>
      </div>
      {children}
    </div>
  )
}
