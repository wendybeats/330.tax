"use client";

import Link from "next/link";
import {
  Mail,
  ListChecks,
  Download,
  ShieldCheck,
  Brain,
  FileText,
  Lock,
  EyeOff,
  ServerCog,
  ArrowRight,
  Check,
  Globe,
  ChevronRight,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const steps = [
  {
    icon: Mail,
    title: "Connect",
    description:
      "Link your Gmail account with read-only access. We scan booking confirmations, boarding passes, and hotel receipts.",
  },
  {
    icon: ListChecks,
    title: "Review",
    description:
      "Our AI reconstructs your travel timeline day by day. Verify dates, fill gaps, and flag overlaps instantly.",
  },
  {
    icon: Download,
    title: "Export",
    description:
      "Download an IRS-ready report of your days abroad. Attach it to your return with confidence.",
  },
];

const features = [
  {
    icon: Mail,
    title: "Gmail Integration",
    description:
      "Securely connects to your inbox and surfaces only travel-related emails. Flight confirmations, hotel bookings, and Airbnb receipts are parsed automatically.",
  },
  {
    icon: Brain,
    title: "AI-Powered Parsing",
    description:
      "Powered by Claude, our parser extracts departure dates, arrival cities, and stay durations from unstructured email text with high accuracy.",
  },
  {
    icon: FileText,
    title: "IRS-Ready Exports",
    description:
      "Generate a clean day-by-day log that satisfies IRS documentation requirements for the Foreign Earned Income Exclusion under Section 911.",
  },
];

const trustSignals = [
  {
    icon: EyeOff,
    title: "Read-Only Gmail Access",
    description: "We never send, modify, or delete your emails.",
  },
  {
    icon: Lock,
    title: "No Email Content Stored",
    description: "Only extracted travel data is persisted. Raw emails are never saved.",
  },
  {
    icon: ServerCog,
    title: "Bank-Level Encryption",
    description: "All data encrypted in transit (TLS 1.3) and at rest (AES-256).",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <Globe className="size-5 text-primary" />
            <span className="text-lg font-semibold tracking-tight">
              330.tax
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Log in
            </Link>
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--color-muted)_0%,transparent_60%)]" />
        <div className="mx-auto max-w-4xl px-6 pb-24 pt-24 text-center sm:pt-32 lg:pt-40">
          <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            IRS Section 911 &middot; Foreign Earned Income Exclusion
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            330 days abroad.
            <br />
            <span className="text-muted-foreground">
              Prove it in minutes.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Automatically reconstruct your travel timeline from email
            confirmations. No spreadsheets, no guesswork &mdash; just an
            IRS-ready log of every day you spent outside the U.S.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/login" className={buttonVariants({ size: "lg", className: "h-12 px-8 text-base" })}>
              Get Started Free
              <ArrowRight className="ml-1 size-4" />
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              See how it works
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Three steps to compliance
            </h2>
            <p className="mt-3 text-muted-foreground">
              From inbox to IRS-ready report in under five minutes.
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            {steps.map((step, i) => (
              <div key={step.title} className="relative text-center">
                {i < steps.length - 1 && (
                  <div className="absolute right-0 top-10 hidden h-px w-full translate-x-1/2 bg-border sm:block" />
                )}
                <div className="relative mx-auto flex size-20 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <step.icon className="size-8" strokeWidth={1.5} />
                </div>
                <div className="absolute -top-3 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full bg-background text-xs font-bold ring-1 ring-border">
                  {i + 1}
                </div>
                <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Built for expats who want peace of mind
            </h2>
            <p className="mt-3 text-muted-foreground">
              Everything you need to document your physical presence test.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="bg-card">
                <CardHeader>
                  <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
                    <feature.icon
                      className="size-5 text-foreground"
                      strokeWidth={1.5}
                    />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-3 text-muted-foreground">
              Start free. Upgrade when you need to file.
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2">
            {/* Free tier */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-xl">Free</CardTitle>
                <CardDescription>
                  Perfect for exploring your travel history
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="mb-6">
                  <span className="text-4xl font-bold">$0</span>
                  <span className="ml-1 text-muted-foreground">forever</span>
                </div>
                <ul className="space-y-3 text-sm">
                  {[
                    "Gmail data ingestion",
                    "Interactive timeline view",
                    "Day-by-day travel log",
                    "Gap & overlap detection",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <Link href="/login" className={buttonVariants({ variant: "outline", className: "w-full" })}>
                    Get Started
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Pro tier */}
            <Card className="relative flex flex-col ring-2 ring-primary">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                Most Popular
              </div>
              <CardHeader>
                <CardTitle className="text-xl">Pro</CardTitle>
                <CardDescription>
                  Everything you need to file with confidence
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="mb-6">
                  <span className="text-4xl font-bold">$29</span>
                  <span className="ml-1 text-muted-foreground">/ year</span>
                </div>
                <ul className="space-y-3 text-sm">
                  {[
                    "Everything in Free",
                    "IRS-ready PDF & CSV exports",
                    "Smart gap detection with suggestions",
                    "Multi-year history",
                    "Priority support",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-foreground" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <Link href="/login" className={buttonVariants({ className: "w-full" })}>
                    Start Free, Upgrade Anytime
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Your privacy comes first
            </h2>
            <p className="mt-3 text-muted-foreground">
              We built 330.tax with security at every layer.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            {trustSignals.map((signal) => (
              <div
                key={signal.title}
                className="flex flex-col items-center text-center"
              >
                <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <signal.icon
                    className="size-5 text-foreground"
                    strokeWidth={1.5}
                  />
                </div>
                <h3 className="mt-4 font-semibold">{signal.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {signal.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-primary text-primary-foreground">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Stop guessing. Start proving.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-primary-foreground/70">
            Join thousands of expats who use 330.tax to document their physical
            presence test and claim the Foreign Earned Income Exclusion with
            confidence.
          </p>
          <div className="mt-8">
            <Link href="/login" className={buttonVariants({ variant: "secondary", size: "lg", className: "h-12 px-8 text-base" })}>
              Get Started Free
              <ArrowRight className="ml-1 size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Link href="/" className="flex items-center gap-2">
                <Globe className="size-5 text-primary" />
                <span className="text-lg font-semibold tracking-tight">
                  330.tax
                </span>
              </Link>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
                The fastest way to document your foreign physical presence for
                IRS Section 911.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Product</h4>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link
                    href="#how-it-works"
                    className="transition-colors hover:text-foreground"
                  >
                    How It Works
                  </Link>
                </li>
                <li>
                  <Link
                    href="#"
                    className="transition-colors hover:text-foreground"
                  >
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link
                    href="#"
                    className="transition-colors hover:text-foreground"
                  >
                    Security
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Legal</h4>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link
                    href="#"
                    className="transition-colors hover:text-foreground"
                  >
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    href="#"
                    className="transition-colors hover:text-foreground"
                  >
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link
                    href="#"
                    className="transition-colors hover:text-foreground"
                  >
                    Contact
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} 330.tax. All rights reserved. Not
            tax advice &mdash; consult a qualified tax professional.
          </div>
        </div>
      </footer>
    </div>
  );
}
