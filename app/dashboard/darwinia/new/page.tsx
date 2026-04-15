"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { IconDna, IconLoader } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

const CLIENT_ADDRESS = process.env.NEXT_PUBLIC_ARC_CLIENT_ADDRESS || ""

export default function NewJobPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: "BTC/USDT Strategy Evolution",
    description: "Evolve a trading strategy for BTC/USDT using genetic algorithms",
    target_symbol: "BTC/USDT",
    max_generations: 20,
    population_size: 50,
    budget_usdc: 0.1,
    price_per_iteration_usdc: 0.001,
  })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch("/api/darwinia/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          client_wallet_address: "0xa785c26A95a6CDfbE85edD71388a23854d441c36",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to create job")
      toast.success("Job created! Agent will claim it shortly.")
      router.push(`/dashboard/darwinia/${data.job.id}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-xl">
      <div className="flex items-center gap-3">
        <IconDna className="size-7 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">New Optimization Job</h1>
          <p className="text-sm text-muted-foreground">
            Darwinia agents will evolve a strategy and settle via Nanopayments on Arc
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Job Title</Label>
          <Input id="title" value={form.title} onChange={set("title")} required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Input id="description" value={form.description} onChange={set("description")} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="target_symbol">Target Symbol</Label>
            <Input id="target_symbol" value={form.target_symbol} onChange={set("target_symbol")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="max_generations">Generations</Label>
            <Input
              id="max_generations"
              type="number"
              min={1}
              max={100}
              value={form.max_generations}
              onChange={set("max_generations")}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="budget_usdc">Total Budget (USDC)</Label>
            <Input
              id="budget_usdc"
              type="number"
              step="0.001"
              min="0.001"
              value={form.budget_usdc}
              onChange={set("budget_usdc")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="price_per_iteration_usdc">Price / Iteration (USDC)</Label>
            <Input
              id="price_per_iteration_usdc"
              type="number"
              step="0.0001"
              min="0.0001"
              value={form.price_per_iteration_usdc}
              onChange={set("price_per_iteration_usdc")}
            />
          </div>
        </div>

        {/* Cost summary */}
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm">
          <p className="font-medium text-blue-800">💡 Cost Estimate</p>
          <p className="text-blue-700 mt-1">
            {form.max_generations} generations × ${Number(form.price_per_iteration_usdc).toFixed(4)} ={" "}
            <strong>
              ${(form.max_generations * Number(form.price_per_iteration_usdc)).toFixed(4)} USDC
            </strong>{" "}
            via Circle Nanopayments on Arc
          </p>
          <p className="text-blue-600 text-xs mt-1">
            Each iteration result is unlocked individually — pay only for what you use.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={loading} className="gap-2">
            {loading && <IconLoader className="size-4 animate-spin" />}
            Create Job
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
