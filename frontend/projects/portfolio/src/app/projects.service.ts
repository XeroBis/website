import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** `ProjectOut` from `/api/portfolio/projects`. */
export interface Project {
  id: number;
  name: string;
  description_fr: string;
  description_en: string;
  repo_url: string | null;
  featured: boolean;
  position: number;
  /** Sorted case-insensitively. */
  tags: string[];
}

/** `ProjectIn`: the create and full-update body. */
export type ProjectInput = Omit<Project, 'id'>;

const API = '/api/portfolio';

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly http = inject(HttpClient);

  /** Every project, in the public page's order. */
  list(): Promise<Project[]> {
    return firstValueFrom(this.http.get<Project[]>(`${API}/projects`));
  }

  get(id: number): Promise<Project> {
    return firstValueFrom(this.http.get<Project>(`${API}/projects/${id}`));
  }

  /** Every tag in use. */
  tags(): Promise<string[]> {
    return firstValueFrom(this.http.get<string[]>(`${API}/tags`));
  }

  create(project: ProjectInput): Promise<Project> {
    return firstValueFrom(this.http.post<Project>(`${API}/projects`, project));
  }

  update(id: number, project: ProjectInput): Promise<Project> {
    return firstValueFrom(this.http.put<Project>(`${API}/projects/${id}`, project));
  }

  delete(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${API}/projects/${id}`));
  }
}
