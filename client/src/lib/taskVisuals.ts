import {
  AlertTriangle, ArrowUp, ArrowDown, Minus,
  Inbox, Loader, CheckCircle2,
} from 'lucide-react'
import type { Task } from '@/hooks/useTasks'

/*
 * Single source of truth for how priorities and statuses look across the app.
 * Only urgent/high carry color so the board stays calm; medium/low recede.
 * Status hues map to the semantic tokens in index.css:
 *   inbox/todo → primary (blue) · in_progress → warning (amber) · done → success (green)
 */

export interface PriorityVisual {
  icon: React.ElementType
  color: string
  /** pill style for badge-like contexts (import dialogs, chips) */
  badge: string
  label: string
  order: number
}

export const PRIORITY_CONFIG: Record<Task['priority'], PriorityVisual> = {
  urgent: { icon: AlertTriangle, color: 'text-destructive', badge: 'bg-destructive/15 text-destructive', label: 'Urgent', order: 0 },
  high: { icon: ArrowUp, color: 'text-warning', badge: 'bg-warning/15 text-warning', label: 'High', order: 1 },
  medium: { icon: Minus, color: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground', label: 'Medium', order: 2 },
  low: { icon: ArrowDown, color: 'text-muted-foreground/60', badge: 'bg-muted text-muted-foreground/70', label: 'Low', order: 3 },
}

export interface StatusVisual {
  icon: React.ElementType
  color: string
  label: string
  badgeVariant: 'default' | 'secondary' | 'outline'
}

export const STATUS_CONFIG: Record<Task['status'], StatusVisual> = {
  backlog: { icon: Inbox, color: 'text-muted-foreground', label: 'Backlog', badgeVariant: 'outline' },
  todo: { icon: Inbox, color: 'text-primary', label: 'To Do', badgeVariant: 'secondary' },
  in_progress: { icon: Loader, color: 'text-warning', label: 'In Progress', badgeVariant: 'default' },
  done: { icon: CheckCircle2, color: 'text-success', label: 'Done', badgeVariant: 'outline' },
}

export function priorityVisual(priority: Task['priority']): PriorityVisual {
  return PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium
}

export function statusVisual(status: Task['status']): StatusVisual {
  return STATUS_CONFIG[status] || STATUS_CONFIG.todo
}
