import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Background auto-pull: every `INTERVAL_MS`, ask the server which
// integrations have autoSync enabled and call their merge endpoint so
// changes made directly in Trello/ClickUp get reflected in Shipyard. Push
// after local task mutations is handled server-side (triggerAutoSync in
// routes/tasks.ts); this hook is strictly the pull/merge side.
//
// Runs once at the top-level Layout and uses a module-level guard to avoid
// concurrent merges for the same integration when the tab is restored or
// Strict Mode double-mounts in dev.

const INTERVAL_MS = 45_000
const running = new Set<string>()

export function useIntegrationAutoPull() {
  const queryClient = useQueryClient()
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false

    const tick = async () => {
      if (cancelled.current) return
      try {
        const { integrations } = await api.listIntegrations()
        const active = integrations.filter(i => i.enabled && i.autoSync)
        for (const i of active) {
          const key = `${i.projectId}:${i.providerId}`
          if (running.has(key)) continue
          running.add(key)
          try {
            const result = await api.mergeIntegration(i.projectId, i.providerId)
            if (result.success && ((result.created ?? 0) + (result.updated ?? 0) > 0)) {
              queryClient.invalidateQueries({ queryKey: ['tasks', i.projectId] })
              queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
            }
          } catch {
            // Swallow — status is persisted server-side. UI surfaces it via
            // the integrations query.
          } finally {
            running.delete(key)
          }
        }
      } catch {
        // ignore — next tick retries
      }
    }

    const interval = window.setInterval(tick, INTERVAL_MS)
    // Kick off once on mount, slightly delayed so initial page load finishes first.
    const kickoff = window.setTimeout(tick, 5_000)

    return () => {
      cancelled.current = true
      window.clearInterval(interval)
      window.clearTimeout(kickoff)
    }
  }, [queryClient])
}
