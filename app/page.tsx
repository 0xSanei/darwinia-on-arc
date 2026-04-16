/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthButton } from "@/components/auth-button"
import { ThemeSwitcher } from "@/components/theme-switcher"
import Link from "next/link"
import { Suspense } from "react"

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-background">
      {/* Nav */}
      <nav className="w-full flex justify-center border-b border-border h-16">
        <div className="w-full max-w-5xl flex justify-between items-center px-5 text-sm">
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-bold text-xl">
              🧬 Darwinia on Arc
            </span>
          </div>
          <Suspense>
            <AuthButton />
          </Suspense>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-5 py-20 text-center">
        <div className="inline-flex items-center gap-2 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full mb-6 font-medium">
          🏆 lablab.ai · Agentic Economy on Arc Hackathon 2026
        </div>

        <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 leading-tight">
          <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
            Evolve Better Strategies.
          </span>
          <br />
          <span className="text-foreground">Pay Per Insight.</span>
        </h1>

        <p className="text-xl text-muted-foreground max-w-2xl mb-4">
          Post an optimization job. Our genetic algorithm agent evolves hundreds of trading strategy variants.
          Unlock results one-by-one with{" "}
          <span className="font-semibold text-foreground">$0.001 USDC Nanopayments</span>
          {" "}on Arc — no subscriptions, no minimums.
        </p>

        <p className="text-sm text-muted-foreground mb-10">
          Powered by{" "}
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">x402</span>
          {" "}·{" "}
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">EIP-3009</span>
          {" "}·{" "}
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">Circle Nanopayments</span>
          {" "}·{" "}
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">Arc Testnet</span>
        </p>

        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            href="/dashboard/darwinia"
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors text-sm"
          >
            Launch App →
          </Link>
          <Link
            href="/dashboard/darwinia/new"
            className="px-8 py-3 border border-border hover:bg-accent rounded-lg font-semibold transition-colors text-sm"
          >
            Create Optimization Job
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 border-t border-border">
        <div className="max-w-5xl mx-auto px-5">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              {
                step: "1",
                icon: "📋",
                title: "Post a Job",
                desc: "Define optimization target, budget, and generations. As little as $0.01 total.",
              },
              {
                step: "2",
                icon: "🧬",
                title: "Agent Evolves",
                desc: "Darwinia's genetic algorithm agent runs population evolution across generations. 17-gene DNA, 215 test cases.",
              },
              {
                step: "3",
                icon: "🔒",
                title: "Results Gated",
                desc: "Each generation result is locked. You see fitness scores — unlock full DNA when you want.",
              },
              {
                step: "4",
                icon: "⚡",
                title: "Pay & Unlock",
                desc: "Click Unlock. EIP-3009 signs a $0.001 USDC transfer. On-chain in seconds via Arc.",
              },
            ].map(({ step, icon, title, desc }) => (
              <div key={step} className="flex flex-col gap-3 p-5 rounded-xl border bg-card">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{icon}</span>
                  <span className="text-xs font-bold text-muted-foreground">Step {step}</span>
                </div>
                <h3 className="font-bold text-lg">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="py-12 border-t border-border bg-muted/30">
        <div className="max-w-5xl mx-auto px-5">
          <h3 className="text-center text-sm font-semibold text-muted-foreground mb-6">BUILT WITH</h3>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              "Circle Nanopayments (x402)",
              "EIP-3009 TransferWithAuthorization",
              "Arc Testnet (Chain 5042002)",
              "USDC (6 decimals)",
              "Darwinia GA Engine",
              "Supabase Realtime",
              "Next.js App Router",
              "viem",
            ].map((tech) => (
              <span
                key={tech}
                className="text-xs px-3 py-1.5 rounded-full border bg-background font-mono"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-border text-center text-xs text-muted-foreground">
        Built by{" "}
        <a href="https://github.com/0xSanei" className="underline">
          0xSanei
        </a>{" "}
        for the Agentic Economy on Arc Hackathon · April 2026
      </footer>
    </main>
  )
}
