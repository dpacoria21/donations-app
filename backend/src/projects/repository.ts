import type { Project } from './model.ts';
import { SEED_PROJECTS } from './seed.ts';

/**
 * Acceso a datos de proyectos. La implementación DynamoDB (tabla `Projects`,
 * GSI `status-createdAt`) reemplazará a la de memoria sin cambiar los handlers.
 */
export interface ProjectRepository {
  listPublished(): Promise<Project[]>;
  findById(projectId: string): Promise<Project | undefined>;
}

export class InMemoryProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project>;

  constructor(projects: readonly Project[]) {
    this.#projects = new Map(projects.map((project) => [project.projectId, { ...project }]));
  }

  listPublished(): Promise<Project[]> {
    const published = [...this.#projects.values()]
      .filter((project) => project.status === 'PUBLICADO')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((project) => ({ ...project }));
    return Promise.resolve(published);
  }

  findById(projectId: string): Promise<Project | undefined> {
    const project = this.#projects.get(projectId);
    return Promise.resolve(project && { ...project });
  }
}

let defaultRepository: ProjectRepository | undefined;

/** Repositorio que usan los handlers desplegados; por ahora, datos de prueba en memoria. */
export function getProjectRepository(): ProjectRepository {
  defaultRepository ??= new InMemoryProjectRepository(SEED_PROJECTS);
  return defaultRepository;
}
