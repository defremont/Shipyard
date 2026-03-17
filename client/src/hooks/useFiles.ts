import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  extension?: string
  mimeHint?: string
}

export interface FileContent {
  content: string
  encoding: string
  mimeHint: string
  size: number
}

export function useFileTree(projectId: string, relPath: string, enabled = true) {
  return useQuery({
    queryKey: ['files', 'tree', projectId, relPath],
    queryFn: () => api.getFileTree(projectId, relPath),
    enabled: !!projectId && enabled,
    staleTime: 10_000,
  })
}

export function useFileContent(projectId: string, relPath: string | null) {
  return useQuery({
    queryKey: ['files', 'content', projectId, relPath],
    queryFn: () => api.getFileContent(projectId, relPath!),
    enabled: !!projectId && !!relPath,
    staleTime: 30_000,
  })
}

export function useDeleteFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, relPath }: { projectId: string; relPath: string }) =>
      api.deleteFile(projectId, relPath),
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['files', 'tree', projectId] })
    },
  })
}

export function useOpenFileFolder() {
  return useMutation({
    mutationFn: ({ projectId, relPath }: { projectId: string; relPath: string }) =>
      api.openFileFolder(projectId, relPath),
  })
}

export function useRenameFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, relPath, newName }: { projectId: string; relPath: string; newName: string }) =>
      api.renameFile(projectId, relPath, newName),
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['files', 'tree', projectId] })
    },
  })
}

export function useSaveFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, relPath, content }: { projectId: string; relPath: string; content: string }) =>
      api.saveFileContent(projectId, relPath, content),
    onSuccess: (_data, { projectId, relPath }) => {
      queryClient.invalidateQueries({ queryKey: ['files', 'content', projectId, relPath] })
    },
  })
}
