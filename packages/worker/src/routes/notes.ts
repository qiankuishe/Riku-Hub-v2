import type { Hono } from 'hono';
import { NotesController } from '../controllers/notes-controller';
import { NotesRepository } from '../repositories/notes-repository';
import { NotesService } from '../services/notes-service';
import type { NotesRepositoryDeps } from '../types/notes';

interface NotesRouteOptions<TEnv extends object> {
  deps: NotesRepositoryDeps<TEnv>;
}

export function mountNotesRoutes<TEnv extends object>(app: Hono<any>, options: NotesRouteOptions<TEnv>): void {
  const controller = new NotesController<TEnv>(
    (env) => new NotesService(new NotesRepository(env, options.deps))
  );

  app.get('/api/notes', (c) => controller.listNotes(c));
  app.post('/api/notes', (c) => controller.createNote(c));
  app.put('/api/notes/:id', (c) => controller.updateNote(c));
  app.delete('/api/notes/:id', (c) => controller.deleteNote(c));
}

