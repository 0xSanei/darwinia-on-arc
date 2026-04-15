"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import {
  IconLoader, IconDna, IconLock, IconLockOpen,
  IconTrendingUp, IconChartLine, IconExternalLink,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import type { DarwiniaJob, DarwiniaIteration, JobStatus } from "@/lib/darwinia/types"
import { signEIP3009, encodeXPaymentHeader } from "@/lib/darwinia/eip3009"

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  claimed: "bg-blue-100 text-blue-800",
  running: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-600",
}

interface IterationSummary {
  id: string
  generation: number
  champion_fitness: number
  avg_fitness: number
  genetic_diversity: number
  patterns_discovered: number
  is_unlocked: boolean
  created_at: string
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<DarwiniaJob | null>(null)
  const [iterations, setIterations] = useState<IterationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [unlocking, setUnlocking] = useState<string | null>(null)
  const [unlockedDetail, setUnlockedDetail] = useState<Record<string, any>>({})

  async function fetchData() {
    const res = await fetch(`/api/darwinia/jobs/${id}`)
    const data = await res.json()
    if (res.ok) {
      setJob(data.job)
      setIterations(data.iterations)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()

    const supabase = createClient()
    const channel = supabase
      .channel(`job_${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "darwinia_iterations", filter: `job_id=eq.${id}` },
        fetchData,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "darwinia_jobs", filter: `id=eq.${id}` },
        fetchData,
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function unlockIteration(iterationId: string, priceUsdc: number) {
    setUnlocking(iterationId)
    try {
      // Step 1: Get 402 payment requirement
      const res402 = await fetch(`/api/darwinia/iterations/${iterationId}/detail`)
      if (res402.status !== 402) {
        // Already unlocked or other error
        const data = await res402.json()
        if (res402.ok) {
          setUnlockedDetail(d => ({ ...d, [iterationId]: data.iteration }))
          setIterations(prev => prev.map(it => it.id === iterationId ? { ...it, is_unlocked: true } : it))
          return
        }
        throw new Error(data.error || "Unexpected response")
      }

      const { paymentRequirement } = await res402.json()

      // Step 2: Sign EIP-3009 (server-side demo: use env private key via API)
      const signRes = await fetch("/api/darwinia/sign-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: paymentRequirement.payTo,
          amountUsdc: priceUsdc.toString(),
        }),
      })
      const { xPaymentHeader } = await signRes.json()
      if (!signRes.ok) throw new Error("Failed to sign payment")

      // Step 3: Retry with X-PAYMENT header
      const res200 = await fetch(`/api/darwinia/iterations/${iterationId}/detail`, {
        headers: { "x-payment": xPaymentHeader },
      })
      const data = await res200.json()
      if (!res200.ok) throw new Error(data.error || "Payment failed")

      setUnlockedDetail(d => ({ ...d, [iterationId]: data.iteration }))
      setIterations(prev => prev.map(it => it.id === iterationId ? { ...it, is_unlocked: true } : it))

      toast.success(
        `Iteration ${iterationId.slice(0, 6)} unlocked! TX: ${data.payment?.tx_hash?.slice(0, 10)}...`,
      )
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setUnlocking(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!job) {
    return <div className="p-6 text-muted-foreground">Job not found.</div>
  }

  const progress = job.max_generations > 0
    ? Math.round((iterations.length / job.max_generations) * 100)
    : 0

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <IconDna className="size-7 text-blue-600 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{job.title}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}>
                {job.status}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {job.target_symbol} · {job.max_generations} generations · ${Number(job.price_per_iteration_usdc).toFixed(4)} USDC / iteration
            </p>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Evolution Progress</span>
          <span className="text-sm text-muted-foreground">{iterations.length} / {job.max_generations} generations</span>
        </div>
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {job.status === "running" && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <IconLoader className="size-3 animate-spin" />
            Darwinia agent is evolving…
          </p>
        )}
      </div>

      {/* Champion so far */}
      {iterations.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium mb-3 flex items-center gap-2">
            <IconTrendingUp className="size-4 text-green-600" />
            Current Champion
          </p>
          {(() => {
            const best = [...iterations].sort((a, b) => b.champion_fitness - a.champion_fitness)[0]
            return (
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Fitness</p>
                  <p className="text-xl font-bold text-green-600">{best.champion_fitness.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Generation</p>
                  <p className="text-xl font-bold">{best.generation}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Avg Fitness</p>
                  <p className="text-xl font-bold">{best.avg_fitness.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Patterns Found</p>
                  <p className="text-xl font-bold">{best.patterns_discovered}</p>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Iterations list */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <IconChartLine className="size-5" />
          Iterations
          <span className="text-xs font-normal text-muted-foreground">
            (unlock each with Nanopayment to see full genome + patterns)
          </span>
        </h2>

        {iterations.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">
            Waiting for agent to start evolution…
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {iterations.map((iter) => {
              const detail = unlockedDetail[iter.id]
              return (
                <div key={iter.id} className="rounded-lg border bg-card overflow-hidden">
                  {/* Summary row */}
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {iter.is_unlocked
                          ? <IconLockOpen className="size-4 text-green-500" />
                          : <IconLock className="size-4 text-muted-foreground" />}
                        <span className="font-mono text-sm font-semibold">Gen {iter.generation}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="text-green-600 font-medium">
                          ★ {iter.champion_fitness.toFixed(4)}
                        </span>
                        <span>avg {iter.avg_fitness.toFixed(4)}</span>
                        <span>div {iter.genetic_diversity.toFixed(3)}</span>
                        <span>{iter.patterns_discovered} patterns</span>
                      </div>
                    </div>

                    {!iter.is_unlocked && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={unlocking === iter.id}
                        onClick={() => unlockIteration(iter.id, Number(job.price_per_iteration_usdc))}
                        className="gap-2 text-xs"
                      >
                        {unlocking === iter.id
                          ? <><IconLoader className="size-3 animate-spin" /> Paying…</>
                          : <><IconLockOpen className="size-3" /> Unlock ${Number(job.price_per_iteration_usdc).toFixed(4)} USDC</>}
                      </Button>
                    )}
                  </div>

                  {/* Unlocked detail */}
                  {iter.is_unlocked && detail?.champion_genes && (
                    <div className="border-t bg-muted/30 p-4">
                      <p className="text-xs font-semibold text-muted-foreground mb-3">Champion DNA (17 genes)</p>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(detail.champion_genes as Record<string, number>).map(([gene, val]) => (
                          <div key={gene} className="flex flex-col">
                            <span className="text-xs text-muted-foreground truncate">
                              {gene.replace("weight_", "w_")}
                            </span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full"
                                  style={{ width: `${Math.round(val * 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono w-8 text-right">{val.toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
