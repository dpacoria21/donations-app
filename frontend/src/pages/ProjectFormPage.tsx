import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useForm, type FieldError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, getJson, sendJson } from '../api/client.ts';
import { useAuth, type SessionUser } from '../auth/context.ts';
import { SignInPrompt } from '../components/SignInPrompt.tsx';
import { centsToSoles, formatPen, solesToCents } from '../lib/format.ts';
import { projectFormSchema, type ProjectFormValues } from '../projects/schemas.ts';
import { projectKeys, type Project, type ProjectList } from '../projects/types.ts';
import type { ManageLocationState } from './ManagePage.tsx';
import { NotFoundPage } from './NotFoundPage.tsx';

/** Crear (`/gestion/nuevo`) o editar (`/gestion/:projectId/editar`) un proyecto (HU-08, D2). */
export function ProjectFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { user } = useAuth();
  const title = mode === 'create' ? 'Nuevo proyecto' : 'Editar proyecto';
  if (!user) {
    return (
      <SignInPrompt
        title={title}
        message="Inicia sesión con una cuenta de gestor para continuar."
      />
    );
  }
  return mode === 'create' ? <CreateProject user={user} /> : <EditProject user={user} />;
}

function CreateProject({ user }: { user: SessionUser }) {
  return (
    <ProjectForm
      user={user}
      heading="Nuevo proyecto"
      intro="El proyecto se crea como borrador: no aparece en el catálogo hasta que lo publiques."
      submitLabel="Crear borrador"
      defaults={{ title: '', description: '', goal: '' }}
      buildRequest={(values) => ({
        method: 'POST',
        path: '/v1/projects',
        body: {
          title: values.title.trim(),
          description: values.description.trim(),
          goalAmountCents: solesToCents(values.goal),
        },
      })}
      notice={(project) => `Se creó el borrador «${project.title}».`}
    />
  );
}

function EditProject({ user }: { user: SessionUser }) {
  const { projectId = '' } = useParams();
  // El GESTOR edita también borradores, que la ruta pública no devuelve: se usa su listado.
  const query = useQuery({
    queryKey: projectKeys.managed,
    queryFn: ({ signal }) =>
      getJson<ProjectList>('/v1/manage/projects', { accessToken: user.accessToken, signal }),
  });

  if (query.isPending) {
    return (
      <p role="status" className="mt-2">
        Cargando el proyecto…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="mt-2 text-red-800">
        {query.error instanceof ApiError && query.error.status === 403
          ? 'Solo los usuarios con rol GESTOR pueden editar proyectos.'
          : 'No se pudo cargar el proyecto.'}
      </p>
    );
  }
  const project = query.data.items.find((item) => item.projectId === projectId);
  if (!project) return <NotFoundPage title="Proyecto no encontrado" />;

  const original: ProjectFormValues = {
    title: project.title,
    description: project.description,
    goal: centsToSoles(project.goalAmountCents),
  };
  return (
    <ProjectForm
      user={user}
      heading="Editar proyecto"
      intro={
        project.confirmedAmountCents > 0
          ? `Ya se recaudaron ${formatPen(project.confirmedAmountCents)}: la meta no puede ser menor.`
          : 'Los cambios quedan registrados en la auditoría.'
      }
      submitLabel="Guardar cambios"
      defaults={original}
      buildRequest={(values) => {
        // Solo se envían los campos que cambiaron: la auditoría registra exactamente esos.
        const body: Record<string, unknown> = {};
        if (values.title.trim() !== original.title) body.title = values.title.trim();
        if (values.description.trim() !== original.description) {
          body.description = values.description.trim();
        }
        const goal = solesToCents(values.goal);
        if (goal !== project.goalAmountCents) body.goalAmountCents = goal;
        return Object.keys(body).length === 0
          ? null
          : { method: 'PATCH', path: `/v1/projects/${project.projectId}`, body };
      }}
      notice={(updated) => `Se guardaron los cambios de «${updated.title}».`}
    />
  );
}

interface ProjectFormProps {
  user: SessionUser;
  heading: string;
  intro: string;
  submitLabel: string;
  defaults: ProjectFormValues;
  /** `null` si no hay nada que enviar. */
  buildRequest: (
    values: ProjectFormValues,
  ) => { method: 'POST' | 'PATCH'; path: string; body: Record<string, unknown> } | null;
  notice: (project: Project) => string;
}

function ProjectForm({
  user,
  heading,
  intro,
  submitLabel,
  defaults,
  buildRequest,
  notice,
}: ProjectFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (request: NonNullable<ReturnType<ProjectFormProps['buildRequest']>>) =>
      sendJson<Project>(request.method, request.path, {
        accessToken: user.accessToken,
        body: request.body,
      }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      const state: ManageLocationState = { notice: notice(project) };
      await navigate('/gestion', { state });
    },
    onError: (error) => {
      // Un 409 por la meta se muestra junto al campo; el resto, arriba del formulario.
      if (error instanceof ApiError && error.status === 409) {
        form.setError('goal', { message: error.message });
        return;
      }
      form.setError('root.server', {
        message:
          error instanceof ApiError && error.status === 403
            ? 'Solo los usuarios con rol GESTOR pueden guardar proyectos.'
            : error.message,
      });
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    const request = buildRequest(values);
    if (!request) {
      form.setError('root.server', { message: 'No hay cambios que guardar.' });
      return;
    }
    save.mutate(request);
  });

  return (
    <>
      <Link to="/gestion" className="text-sm text-sky-800 underline">
        ← Volver a la gestión
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{heading}</h1>
      <p className="mt-2 text-slate-700">{intro}</p>

      <form noValidate onSubmit={(event) => void onSubmit(event)} className="mt-6 grid gap-4">
        {errors.root?.server && (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-800">
            {errors.root.server.message}
          </p>
        )}
        <Field label="Título" error={errors.title}>
          {(props) => <input {...props} {...form.register('title')} className={inputClass} />}
        </Field>
        <Field label="Descripción (finalidad del proyecto)" error={errors.description}>
          {(props) => (
            <textarea
              {...props}
              {...form.register('description')}
              rows={5}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Meta en soles (S/)" hint="Por ejemplo: 4500 o 4500.50" error={errors.goal}>
          {(props) => (
            <input
              {...props}
              {...form.register('goal')}
              inputMode="decimal"
              autoComplete="off"
              className={inputClass}
            />
          )}
        </Field>
        <div>
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded bg-sky-700 px-4 py-2 font-semibold text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:opacity-60"
          >
            {save.isPending ? 'Guardando…' : submitLabel}
          </button>
        </div>
      </form>
    </>
  );
}

const inputClass =
  'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-sky-700 aria-invalid:border-red-700';

interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

/** Etiqueta, ayuda y error asociados al control para lectores de pantalla (CA-NF06.2). */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error: FieldError | undefined;
  children: (props: FieldControlProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error?.message && (
        <p id={errorId} className="mt-1 text-sm text-red-800">
          {error.message}
        </p>
      )}
    </div>
  );
}
