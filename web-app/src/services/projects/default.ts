/**
 * Default Projects Service - localStorage implementation
 */

import { ulid } from 'ulidx'
import type { ProjectsService, ThreadFolder } from './types'
import { localStorageKey } from '@/constants/localStorage'
import { projectsStorageSchema } from '@/schemas/projects.schema'

export class DefaultProjectsService implements ProjectsService {
  private storageKey = localStorageKey.threadManagement
  private storageQueue: Promise<unknown> = Promise.resolve()

  private enqueueStorageTask<T>(task: () => T | Promise<T>): Promise<T> {
    const run = this.storageQueue.then(task, task)
    this.storageQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private loadFromStorage(): ThreadFolder[] {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (!stored) return []
      const parsed = projectsStorageSchema.safeParse(JSON.parse(stored))
      if (!parsed.success) {
        console.warn('Projects localStorage data did not match expected schema:', parsed.error.message)
        return []
      }
      return (parsed.data.state?.folders ?? []) as ThreadFolder[]
    } catch (error) {
      console.error('Error loading projects from localStorage:', error)
      return []
    }
  }

  private saveToStorage(projects: ThreadFolder[]): void {
    try {
      const data = {
        state: { folders: projects },
        version: 0,
      }
      localStorage.setItem(this.storageKey, JSON.stringify(data))
    } catch (error) {
      console.error('Error saving projects to localStorage:', error)
    }
  }

  async getProjects(): Promise<ThreadFolder[]> {
    return this.enqueueStorageTask(() => this.loadFromStorage())
  }

  async addProject(
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ): Promise<ThreadFolder> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Project name must not be empty')
    if (trimmed.length > 200) throw new Error('Project name must be at most 200 characters')

    return this.enqueueStorageTask(() => {
      const newProject: ThreadFolder = {
        id: ulid(),
        name: trimmed,
        updated_at: Date.now(),
        assistantId,
        logo,
        projectPrompt: projectPrompt ?? null,
      }

      const projects = this.loadFromStorage()
      const updatedProjects = [...projects, newProject]
      this.saveToStorage(updatedProjects)

      return newProject
    })
  }

  async updateProject(
    id: string,
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ): Promise<void> {
    await this.enqueueStorageTask(() => {
      const projects = this.loadFromStorage()
      const updatedProjects = projects.map((project) =>
        project.id === id
          ? {
              ...project,
              name,
              updated_at: Date.now(),
              assistantId,
              logo,
              projectPrompt: projectPrompt ?? null,
            }
          : project
      )
      this.saveToStorage(updatedProjects)
    })
  }

  async deleteProject(id: string): Promise<void> {
    await this.enqueueStorageTask(() => {
      const projects = this.loadFromStorage()
      const updatedProjects = projects.filter((project) => project.id !== id)
      this.saveToStorage(updatedProjects)
    })
  }

  async getProjectById(id: string): Promise<ThreadFolder | undefined> {
    return this.enqueueStorageTask(() => {
      const projects = this.loadFromStorage()
      return projects.find((project) => project.id === id)
    })
  }

  async setProjects(projects: ThreadFolder[]): Promise<void> {
    await this.enqueueStorageTask(() => {
      this.saveToStorage(projects)
    })
  }
}
