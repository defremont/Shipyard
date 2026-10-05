/**
 * Git speaks in paths relative to the repository; the editor and the file
 * routes speak in paths relative to the project. They are the same thing only
 * when the project is one repository — a client folder holding a dozen
 * checkouts has every changed file one folder deeper than git says.
 */
function prefixOf(subrepo?: string): string {
  const clean = (subrepo || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return clean ? `${clean}/` : ''
}

/** A path as git reports it → the same file from the project root. */
export function toProjectPath(repoPath: string, subrepo?: string): string {
  return prefixOf(subrepo) + repoPath
}

/** A path from the project root → as the sub-repository's git knows it. */
export function toRepoPath(projectPath: string, subrepo?: string): string {
  const prefix = prefixOf(subrepo)
  return prefix && projectPath.startsWith(prefix) ? projectPath.slice(prefix.length) : projectPath
}
