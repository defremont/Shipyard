import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type InboxDelivery } from '@/lib/api'
import type { Task } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { useProjects } from '@/hooks/useProjects'
import { useInboxStatus } from '@/hooks/useInbox'

/**
 * Says where each WhatsApp demand landed the moment the server delivers it:
 * "#97 · Canoe — Claudio's follow-up became a note on this task", with Open.
 * Without it, finding the task meant going back to the web area, opening
 * "Enviadas" and searching the number here.
 *
 * Deliveries made before the window loaded are not news and never toast.
 */
export function useInboxArrivals() {
  const { data: status } = useInboxStatus()
  const queryClient = useQueryClient()
  const { openTab } = useTabs()
  const { data: projects } = useProjects()
  const since = useRef<string | null>(null)

  const { data } = useQuery({
    queryKey: ['inbox-deliveries'],
    queryFn: () => api.getInboxDeliveries(),
    enabled: !!status?.configured,
    refetchInterval: 10_000,
  })

  const open = async (d: InboxDelivery) => {
    openTab(d.projectId)
    let task = queryClient.getQueryData<Task[]>(['tasks', d.projectId, 'all'])?.find(t => t.id === d.taskId)
    if (!task) {
      const { tasks } = await api.getTasks(d.projectId)
      task = (tasks as Task[]).find(t => t.id === d.taskId)
    }
    if (task) window.dispatchEvent(new CustomEvent('shipyard:open-task', { detail: task }))
    else toast.error(`Task #${d.taskNumber ?? '?'} is no longer in ${d.projectId}`)
  }

  useEffect(() => {
    if (!data) return
    const list = data.deliveries
    if (since.current === null) {
      // First answer: remember where "now" is, show nothing.
      since.current = list[0]?.at ?? new Date(0).toISOString()
      return
    }
    const fresh = list.filter(d => d.at > since.current!)
    if (fresh.length === 0) return
    since.current = fresh[0].at
    for (const projectId of new Set(fresh.map(d => d.projectId))) {
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
    }
    queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    for (const d of fresh.slice().reverse()) {
      const project = projects?.find(p => p.id === d.projectId)?.name ?? d.projectId
      const where = `#${d.taskNumber ?? '?'} · ${project}`
      toast(d.asNote ? `Follow-up on ${where}` : `New task ${where}`, {
        description: d.asNote
          ? `${d.client ? `${d.client}: ` : ''}${d.title.replace(/^Complemento:\s*/i, '')} — added as a note to “${d.taskTitle}”`
          : `${d.client ? `${d.client}: ` : ''}${d.title}`,
        duration: 15_000,
        action: { label: 'Open', onClick: () => { void open(d) } },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
}
