"use client"

export const dynamic = 'force-dynamic'

import { useEffect, useState } from "react"
import Link from "next/link"
import { IconDna, IconPlus, IconLoader, IconChevronRight, IconArrowsRightLeft } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import type { DarwiniaJob, JobStatus } from "@/lib/darwinia/types"

/** Circle App Kit status banner — shows Arc Testnet is supported */
function AppKitBanner() {
  const [kitVersion, setKitVersion] = useState<string | null>(null)
  const [arcOk, setArcOk] = useState<boolean | null>(null)

  useEffect(() => {
    fetch("/api/darwinia/app-kit/chains")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setKitVersion(d.kitVersion)
          setArcOk(d.arcTestnetSupported)
        }
      })
      .catch(() => {})
  }, [])

  if (!kitVersion) return null

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
      <IconArrowsRightLeft className="size-3 text-blue-500 shrink-0" />
      <span>
        <span className="font-medium text-blue-700">Circle App Kit v{kitVersion}</span>
        {" · "}Arc Testnet{" "}
        {arcOk
          ? <span className="text-green-600 font-medium">✓ supported</span>
          : <span className="text-yellow-600">checking…</span>}
        {" · "}bridge / send / swap via Circle DCW
      </span>
    </div>
  )
}

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  claimed: "bg-blue-100 text-blue-800",
  running: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-600",
}

export default function DarwiniaJobsPage() {
  const [jobs, setJobs] = useState<DarwiniaJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchJobs() {
      const { data, error } = await supabase
        .from("darwinia_jobs")
        .select("*")
        .order("created_at", { ascending: false })
      if (!error && data) setJobs(data)
      setLoading(false)
    }

    fetchJobs()

    // Realtime subscription
    const channel = supabase
      .channel("darwinia_jobs_list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "darwinia_jobs" },
        () => fetchJobs(),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IconDna className="size-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">Optimization Jobs</h1>
            <p className="text-sm text-muted-foreground">
              Agentic GA optimization, settled via Circle Nanopayments on Arc
            </p>
          </div>
        </div>
        <Link href="/dashboard/darwinia/new">
          <Button className="gap-2">
            <IconPlus className="size-4" />
            New Job
          </Button>
        </Link>
      </div>

      {/* Circle App Kit integration badge */}
      <AppKitBanner />

      {/* Stats bar */}
      {!loading && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Jobs", value: jobs.length },
            { label: "Running", value: jobs.filter(j => j.status === "running").length },
            { label: "Completed", value: jobs.filter(j => j.status === "completed").length },
            {
              label: "Total Budget",
              value: `$${jobs.reduce((s, j) => s + Number(j.budget_usdc), 0).toFixed(2)}`,
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Job list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <IconLoader className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 border rounded-lg">
          <IconDna className="size-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">No optimization jobs yet.</p>
          <Link href="/dashboard/darwinia/new">
            <Button variant="outline" className="gap-2">
              <IconPlus className="size-4" />
              Create your first Job
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <Link key={job.id} href={`/dashboard/darwinia/${job.id}`}>
              <div className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors cursor-pointer">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{job.title}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{job.target_symbol}</span>
                    <span>·</span>
                    <span>{job.max_generations} generations</span>
                    <span>·</span>
                    <span>${Number(job.budget_usdc).toFixed(3)} USDC budget</span>
                    <span>·</span>
                    <span>${Number(job.price_per_iteration_usdc).toFixed(4)} / iteration</span>
                  </div>
                </div>
                <IconChevronRight className="size-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
