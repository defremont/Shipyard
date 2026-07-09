import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// Background auto-pull: every `INTERVAL_MS`, ask the server which
// integrations are enabled and call their merge endpoint so changes made
// directly in Trello/ClickUp are reflected in Shipyard. Push after local
// mutations is handled server-side (triggerAutoSync in routes/tasks.ts);
// this hook is the pull/merge side and runs sync for every enabled
// integration regardless of the legacy `autoSync` flag — the user already
// opted in by enabling the provider for the project.
//
// Runs once at the top-level Layout and uses a module-level guard to avoid
// concurrent merges for the same integration when the tab is restored or
// Strict Mode double-mounts in dev.

const INTERVAL_MS = 30_000
const running = new Set<string>()
// Integrations that have completed at least one pull in this session.
const primed = new Set<string>()

export function useIntegrationAutoPull() {
  const queryClient = useQueryClient()
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false

    const tick = async () => {
      if (cancelled.current) return
      // Nobody is looking — the next tick after the tab is restored will catch up.
      if (document.hidden) return
      try {
        const { integrations } = await api.listIntegrations()
        const active = integrations.filter(i => i.enabled)
        for (const i of active) {
          // One key per (projectId, providerId, milestoneId) so each
          // milestone's board/list pulls independently and concurrent merges
          // don't trample each other's state.
          const key = `${i.projectId}:${i.providerId}:${i.milestoneId}`
          if (running.has(key)) continue
          running.add(key)
          try {
            const result = await api.mergeIntegration(i.projectId, i.providerId, i.milestoneId)
            const created = result.created ?? 0
            const updated = result.updated ?? 0
            const pulled = result.pulled ?? 0
            // Invalidate when the local task store actually changed. The very
            // first pull of a freshly-linked board also refreshes even if
            // every row matched by title and produced no new local entries —
            // but only that first time, otherwise a board that never changes
            // would invalidate every task query every 30s forever.
            const firstPull = !primed.has(key)
            primed.add(key)
            if (result.success && (created > 0 || updated > 0 || (firstPull && pulled > 0))) {
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
