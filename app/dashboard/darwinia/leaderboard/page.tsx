"use client"

export const dynamic = 'force-dynamic'

import { useEffect, useState } from "react"
import { IconTrophy, IconLoader, IconDna, IconWallet } from "@tabler/icons-react"
import { createClient } from "@/lib/supabase/client"
import type { DarwiniaAgent } from "@/lib/darwinia/types"

export default function AgentLeaderboardPage() {
  const [agents, setAgents] = useState<DarwiniaAgent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchAgents() {
      const { data, error } = await supabase
        .from("darwinia_agents")
        .select("*")
        .order("reputation", { ascending: false })
      if (!error && data) setAgents(data as DarwiniaAgent[])
      setLoading(false)
    }

    fetchAgents()

    const channel = supabase
      .channel("leaderboard_agents")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "darwinia_agents" },
        () => fetchAgents(),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const rankColors = [
    "text-yellow-500",   // 1st
    "text-gray-400",     // 2nd
    "text-amber-600",    // 3rd
  ]

  const rankBg = [
    "bg-yellow-50 border-yellow-200",
    "bg-gray-50 border-gray-200",
    "bg-amber-50 border-amber-200",
  ]

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <IconTrophy className="size-7 text-yellow-500" />
        <div>
          <h1 className="text-2xl font-bold">Agent Leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by reputation — earned through completing optimization jobs
          </p>
        </div>
      </div>

      {/* Stats summary */}
      {!loading && agents.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Active Agents</p>
            <p className="text-2xl font-bold mt-1">{agents.filter(a => a.is_active).length}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Iterations Run</p>
            <p className="text-2xl font-bold mt-1">
              {agents.reduce((s, a) => s + a.total_iterations, 0).toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Jobs Completed</p>
            <p className="text-2xl font-bold mt-1">
              {agents.reduce((s, a) => s + a.total_jobs_completed, 0)}
            </p>
          </div>
        </div>
      )}

      {/* Agent list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <IconLoader className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 border rounded-lg">
          <IconTrophy className="size-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">No agents registered yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {agents.map((agent, idx) => (
            <div
              key={agent.id}
              className={`flex items-center justify-between rounded-lg border p-4 ${
                idx < 3 ? rankBg[idx] : "bg-card"
              }`}
            >
              {/* Rank + Name */}
              <div className="flex items-center gap-4">
                <span
                  className={`text-2xl font-black w-8 text-center ${
                    idx < 3 ? rankColors[idx] : "text-muted-foreground"
                  }`}
                >
                  {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
                </span>

                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <IconDna className="size-4 text-blue-600" />
                    <span className="font-semibold">{agent.name}</span>
                    {agent.is_active && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                        active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                    <IconWallet className="size-3" />
                    {agent.wallet_address.slice(0, 8)}…{agent.wallet_address.slice(-6)}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-8 text-right">
                <div>
                  <p className="text-xs text-muted-foreground">Reputation</p>
                  <p className="text-lg font-bold">{agent.reputation.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Jobs Done</p>
                  <p className="text-lg font-bold">{agent.total_jobs_completed}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Iterations</p>
                  <p className="text-lg font-bold">{agent.total_iterations.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer note */}
      <p className="text-xs text-muted-foreground text-center">
        Reputation = total evolution iterations completed. Settled on Arc testnet via Circle Nanopayments.
      </p>
    </div>
  )
}
