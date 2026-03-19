import type { Context } from 'hono';
import { NotesHttpError, NotesService } from '../services/notes-service';
import type { NoteCreateInput, NoteUpdateInput } from '../types/notes';

type NotesContext<TEnv extends object> = Context<{ Bindings: TEnv }>;
type ServiceFactory<TEnv extends object> = (env: TEnv) => NotesService<TEnv>;

export class NotesController<TEnv extends object> {
  constructor(private readonly serviceFor: ServiceFactory<TEnv>) {}

  async listNotes(c: NotesContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).listNotes();
      return c.json(data);
    });
  }

  async createNote(c: NotesContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<NoteCreateInput>(c.req.raw);
      const data = await this.serviceFor(c.env).createNote(body);
      return c.json(data);
    });
  }

  async updateNote(c: NotesContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<NoteUpdateInput>(c.req.raw);
      const data = await this.serviceFor(c.env).updateNote(requireParam(c, 'id'), body);
      return c.json(data);
    });
  }

  async deleteNote(c: NotesContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).deleteNote(requireParam(c, 'id'));
      return c.json(data);
    });
  }

  private async handle(c: NotesContext<TEnv>, task: () => Promise<Response>): Promise<Response> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof NotesHttpError) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: error.status,
          headers: {
            'content-type': 'application/json; charset=UTF-8'
          }
        });
      }
      throw error;
    }
  }
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function requireParam<TEnv extends object>(c: NotesContext<TEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new NotesHttpError(400, `缺少参数: ${name}`);
  }
  return value;
}

