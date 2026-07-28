import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  KanbanSquare,
  List,
  Plus,
  Trash2,
  Github,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SlideOver } from '@/components/SlideOver';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  AssigneeSelect,
  AssigneeFilterSelect,
  CompanySelect,
  matchesAssignee,
  useCompanyMap,
} from '@/components/FormControls';
import { useToast } from '@/components/Toast';
import { useCompanies, useProjects } from '@/hooks';
import {
  companyQuickSchema,
  projectSchema,
  type CompanyQuickInput,
  type ProjectInput,
} from '@/schemas';
import { useSettings } from '@/settings/SettingsContext';
import type { Company, Project, ProjectStage } from '@/types';
import { cn, relativeTime } from '@/lib/utils';

export default function AppDevelopment() {
  const { items, isError, error, invalidate, create, update, remove } = useProjects();
  const { create: createCompany } = useCompanies();
  const companyMap = useCompanyMap();
  const { projectStageValues, projectStageTone } = useSettings();
  const { toast } = useToast();
  // New companies enter the board at the first column, whatever it is named.
  const firstStage = projectStageValues[0];

  const [mode, setMode] = useState<'kanban' | 'list'>('kanban');
  const [assignee, setAssignee] = useState('all');
  const [editing, setEditing] = useState<Project | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [companyDrawerOpen, setCompanyDrawerOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const visible = useMemo(() => {
    return items.filter((p) => matchesAssignee(p.assignedTo, assignee));
  }, [items, assignee]);

  const byStage = (stage: ProjectStage) => visible.filter((p) => p.stage === stage);

  async function onDragEnd(e: DragEndEvent) {
    const projectId = String(e.active.id);
    const newStage = e.over?.id as ProjectStage | undefined;
    if (!newStage) return;
    const project = items.find((p) => p.id === projectId);
    if (!project || project.stage === newStage) return;
    await update.mutateAsync({ id: projectId, data: { stage: newStage } });
    toast(`Moved to ${newStage}`);
  }

  function openEdit(p: Project) {
    setEditing(p);
    setDrawerOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="App Development"
        subtitle={`${items.length} projects in the pipeline`}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              <button
                onClick={() => setMode('kanban')}
                className={cn(
                  'rounded-md p-1.5',
                  mode === 'kanban'
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-400',
                )}
              >
                <KanbanSquare className="h-4 w-4" />
              </button>
              <button
                onClick={() => setMode('list')}
                className={cn(
                  'rounded-md p-1.5',
                  mode === 'list'
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-400',
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add Project
            </Button>
          </>
        }
      />

      {isError && (
        <div className="mb-4">
          <ErrorState error={error} onRetry={invalidate} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AssigneeFilterSelect
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        />
      </div>

      {mode === 'kanban' ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {projectStageValues.map((stage) => (
              <Column
                key={stage}
                stage={stage}
                projects={byStage(stage)}
                companyMap={companyMap}
                onCardClick={openEdit}
                stageTone={projectStageTone}
                onAddCompany={
                  stage === firstStage ? () => setCompanyDrawerOpen(true) : undefined
                }
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <ListView projects={visible} companyMap={companyMap} onRowClick={openEdit} />
      )}

      <ProjectDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        project={editing}
        onCreate={async (data) => {
          await create.mutateAsync(data as Partial<Project>);
          toast('Project added');
          setDrawerOpen(false);
        }}
        onUpdate={async (id, data) => {
          await update.mutateAsync({ id, data: data as Partial<Project> });
          toast('Project updated');
          setDrawerOpen(false);
        }}
        onDelete={async (id) => {
          await remove.mutateAsync(id);
          toast('Project deleted');
          setDrawerOpen(false);
        }}
      />

      <QuickCompanyDrawer
        open={companyDrawerOpen}
        onClose={() => setCompanyDrawerOpen(false)}
        onCreate={async (data) => {
          // Save the company, then drop a matching card into Pre Dev so it
          // can be dragged onward as the work progresses.
          const { record } = await createCompany.mutateAsync(data as Partial<Company>);
          await create.mutateAsync({
            companyId: record.id,
            title: data.companyName,
            stage: firstStage,
            progressPct: 0,
          } as Partial<Project>);
          toast(`Company added to ${firstStage}`);
          setCompanyDrawerOpen(false);
        }}
      />
    </div>
  );
}

// Minimal company capture from the Kanban — just enough to link a project to.
// The rest of the MSME profile is filled in on the Companies page.
function QuickCompanyDrawer({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CompanyQuickInput) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CompanyQuickInput>({
    resolver: zodResolver(companyQuickSchema),
    defaultValues: {
      companyName: '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
    },
  });

  const submit = handleSubmit(async (data) => {
    await onCreate(data);
    reset();
  });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Add Company"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={isSubmitting}>
            Add Company
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company Name" required error={errors.companyName?.message}>
          <Input {...register('companyName')} placeholder="Acme Traders" />
        </Field>
        <Field label="Name" required error={errors.contactName?.message}>
          <Input {...register('contactName')} placeholder="Contact person" />
        </Field>
        <Field label="Phone Number" required error={errors.contactPhone?.message}>
          <Input type="tel" {...register('contactPhone')} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Email" required error={errors.contactEmail?.message}>
          <Input type="email" {...register('contactEmail')} placeholder="name@company.com" />
        </Field>
      </form>
    </SlideOver>
  );
}

function Column({
  stage,
  projects,
  companyMap,
  onCardClick,
  stageTone,
  onAddCompany,
}: {
  stage: ProjectStage;
  projects: Project[];
  companyMap: Record<string, string>;
  onCardClick: (p: Project) => void;
  stageTone: Record<string, string>;
  onAddCompany?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Badge tone={stageTone[stage] ?? 'gray'}>{stage}</Badge>
          <span className="text-xs text-slate-400">{projects.length}</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[120px] flex-1 flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors',
          isOver
            ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-950/30'
            : 'border-slate-200 dark:border-slate-800',
        )}
      >
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} companyMap={companyMap} onClick={onCardClick} />
        ))}
        {projects.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">Drop here</p>
        )}
        {onAddCompany && (
          <button
            type="button"
            onClick={onAddCompany}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:bg-brand-950/30 dark:hover:text-brand-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add Company
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  companyMap,
  onClick,
}: {
  project: Project;
  companyMap: Record<string, string>;
  onClick: (p: Project) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: project.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const company = companyMap[project.companyId];
  const title = project.title || company || 'Project';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onClick(project)}
      className={cn(
        'cursor-grab touch-none rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800',
        isDragging && 'opacity-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </p>
      </div>
      {company !== title && (
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {company ?? 'Unknown company'}
        </p>
      )}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: `${project.progressPct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">{project.progressPct}%</span>
        <div className="flex items-center gap-1.5">
          {project.blocker && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}
          <span className="text-xs text-slate-400">
            {project.assignedTo ?? 'Unassigned'}
          </span>
        </div>
      </div>
    </div>
  );
}

function ListView({
  projects,
  companyMap,
  onRowClick,
}: {
  projects: Project[];
  companyMap: Record<string, string>;
  onRowClick: (p: Project) => void;
}) {
  const { projectStageTone } = useSettings();
  if (projects.length === 0) {
    return (
      <EmptyState icon={<KanbanSquare className="h-10 w-10" />} title="No projects" />
    );
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
          <tr>
            <th className="px-4 py-3 font-medium">Project</th>
            <th className="px-4 py-3 font-medium">Company</th>
            <th className="px-4 py-3 font-medium">Stage</th>
            <th className="px-4 py-3 font-medium">Progress</th>
            <th className="px-4 py-3 font-medium">Assigned</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              onClick={() => onRowClick(p)}
              className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
            >
              <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                {p.title || 'Project'}
              </td>
              <td className="px-4 py-3 text-slate-500">{companyMap[p.companyId] ?? '-'}</td>
              <td className="px-4 py-3">
                <Badge tone={projectStageTone[p.stage] ?? 'gray'}>{p.stage}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-500">{p.progressPct}%</td>
              <td className="px-4 py-3 text-slate-500">{p.assignedTo ?? 'Unassigned'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ProjectDrawer({
  open,
  onClose,
  project,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  onCreate: (data: ProjectInput) => Promise<void>;
  onUpdate: (id: string, data: ProjectInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { projectStageValues } = useSettings();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    values: project
      ? (project as unknown as ProjectInput)
      : {
          companyId: '',
          title: '',
          stage: projectStageValues[0],
          progressPct: 0,
        },
  });

  const submit = handleSubmit(async (data) => {
    if (project) await onUpdate(project.id, data);
    else await onCreate(data);
    reset();
  });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={project ? 'Edit Project' : 'Add Project'}
      footer={
        <div className="flex items-center justify-between">
          {project ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(project.id)}
              className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={isSubmitting}>
              {project ? 'Save' : 'Add Project'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title" error={errors.title?.message}>
          <Input {...register('title')} placeholder="Inventory Dashboard" />
        </Field>
        <Field label="Company" required error={errors.companyId?.message}>
          <CompanySelect {...register('companyId')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stage" required>
            <Select {...register('stage')}>
              {projectStageValues.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Progress %" error={errors.progressPct?.message}>
            <Input type="number" min={0} max={100} {...register('progressPct')} />
          </Field>
        </div>
        <Field label="Repository URL" error={errors.repoUrl?.message}>
          <Input {...register('repoUrl')} placeholder="https://github.com/..." />
        </Field>
        <Field label="Live URL" error={errors.liveUrl?.message}>
          <Input {...register('liveUrl')} placeholder="https://..." />
        </Field>
        <Field label="Next action">
          <Textarea {...register('nextAction')} />
        </Field>
        <Field label="Blocker">
          <Textarea {...register('blocker')} placeholder="Anything holding this up?" />
        </Field>
        <Field label="Assigned to">
          <AssigneeSelect {...register('assignedTo')} />
        </Field>

        {project && (
          <div className="flex items-center gap-3 pt-1 text-sm">
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-brand-600 hover:underline"
              >
                <Github className="h-4 w-4" /> Repo
              </a>
            )}
            {project.liveUrl && (
              <a
                href={project.liveUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-brand-600 hover:underline"
              >
                <ExternalLink className="h-4 w-4" /> Live
              </a>
            )}
          </div>
        )}
        {project && (
          <p className="text-xs text-slate-400">
            Created {relativeTime(project.createdAt)}
            {project.createdBy ? ` by ${project.createdBy}` : ''}.
          </p>
        )}
      </form>
    </SlideOver>
  );
}
