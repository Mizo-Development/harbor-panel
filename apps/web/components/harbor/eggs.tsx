'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Header, Field, Input, Form, Modal, Loading, ErrorBox, useData, type Row } from './shared';
const paperId = 'a2339869-9e45-4e7a-b72f-4d1038abca01';
export function GameEggLibrary() {
  const q = useData<Row[]>('/admin/eggs');
  const [edit, setEdit] = useState<Row | null>(null),
    [definition, setDefinition] = useState('');
  const open = (egg: Row = {}) => {
    setEdit(egg);
    setDefinition(egg.definition ? JSON.stringify(egg.definition, null, 2) : '');
  };
  return (
    <>
      <Header
        eyebrow="Game hosting"
        title="Game eggs"
        description="Pterodactyl eggs define the game, runtime images, startup variables and installation script for your plans."
        action={<Button onClick={() => open()}>Import egg</Button>}
      />
      <div className="mb-6 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Paper is ready automatically</p>
        <p className="mt-2">
          New Minecraft plans use the latest stable Paper release. Harbor fetches and verifies its
          official SHA-256 checksum. Installations keep their resolved version until you reinstall.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link href="/admin/products" className="text-primary underline underline-offset-4">
            Assign eggs to plans
          </Link>
          <a
            href="https://github.com/pterodactyl/game-eggs"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            Browse official Pterodactyl eggs ↗
          </a>
        </div>
      </div>
      {q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <div className="space-y-8">
          {Array.from(new Set(q.data.map((e) => e.nest))).map((nest) => (
            <section key={nest}>
              <h2 className="mb-4 text-sm font-semibold">{nest}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {q
                  .data!.filter((e) => e.nest === nest)
                  .map((egg) => (
                    <div
                      key={egg.id}
                      className="rounded-xl border bg-card p-5 transition-colors hover:border-primary/40"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold">{egg.name}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {egg.archived
                              ? 'Archived · unavailable for new assignments'
                              : egg.id === paperId
                                ? 'Built in · automatic stable downloads'
                                : `${egg.definition.meta.version} · ${egg.definition.variables.length} variables`}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => open(egg)}>
                          {egg.id === paperId ? 'Inspect' : 'Manage'}
                        </Button>
                      </div>
                      <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">
                        {egg.definition.description}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {Object.keys(egg.definition.docker_images)
                          .slice(0, 5)
                          .map((label) => (
                            <span key={label} className="rounded-md bg-muted px-2 py-1 text-xs">
                              {label}
                            </span>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          title={edit.id ? 'Manage game egg' : 'Import Pterodactyl egg'}
          description="Import a PTDL v1 or v2 JSON file. Scripts run inside the installation container on your game node. Review code and images before accepting it."
          close={() => setEdit(null)}
        >
          <Form
            submit={
              edit.id === paperId ? 'Import customized copy' : edit.id ? 'Save egg' : 'Import egg'
            }
            onSubmit={async (f) => {
              const payload = {
                nest: f.get('nest'),
                definition: JSON.parse(definition),
                reviewedScript: f.get('reviewed') === 'on',
                archived: f.get('archived') === 'on',
              };
              if (edit.id && edit.id !== paperId)
                await api.patch(`/admin/eggs/${edit.id}`, payload);
              else await api.post('/admin/eggs', payload);
              await q.mutate();
              setEdit(null);
              toast.success('Game egg saved');
            }}
          >
            <Field label="Nest / game group">
              <Input name="nest" defaultValue={edit.nest || 'Imported'} maxLength={100} required />
            </Field>
            <Field label="Egg JSON file">
              <Input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 750000) {
                    toast.error('Egg files must be smaller than 750 KB');
                    return;
                  }
                  try {
                    const value = JSON.parse(await file.text());
                    setDefinition(JSON.stringify(value, null, 2));
                  } catch (error) {
                    toast.error(getErrorMessage(error));
                  }
                }}
              />
            </Field>
            <Field
              label="Egg definition"
              hint="Review the startup command, scripts.installation and Docker images. Hidden variables stay private to administrators."
            >
              <textarea
                className="min-h-80 w-full rounded-md border bg-background p-3 font-mono text-xs"
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                required
                spellCheck={false}
              />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input name="reviewed" type="checkbox" required className="mt-1" />I reviewed and
              trust this egg’s installation script and container images.
            </label>
            {edit.id && edit.id !== paperId && (
              <label className="flex gap-2 text-sm">
                <input name="archived" type="checkbox" defaultChecked={edit.archived} />
                Archive for new assignments (existing services keep their snapshot)
              </label>
            )}
            {edit.id && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([definition], { type: 'application/json' }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `egg-${edit.id}.json`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export JSON
              </Button>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}
export function GamePlanFields({ defaults }: { defaults: Row }) {
  const q = useData<Row[]>('/admin/eggs');
  const [id, setId] = useState(defaults.eggId || paperId);
  const egg = q.data?.find((e) => e.id === id);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <Field label="Game egg">
        <select
          name="eggId"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {q.data
            .filter((e) => !e.archived || e.id === id)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.nest} / {e.name}
                {e.archived ? ' (archived)' : ''}
              </option>
            ))}
        </select>
      </Field>
      {egg && (
        <div key={id} className="space-y-4">
          <Field
            label="Runtime image"
            hint={
              id === paperId
                ? 'Automatic Paper selects the Java version required by the resolved Minecraft release.'
                : 'Only images declared by this egg can be used.'
            }
          >
            <select
              name="eggImage"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              defaultValue={defaults.eggId === id ? defaults.image : ''}
            >
              <option value="">Egg default{id === paperId ? ' (automatic Java)' : ''}</option>
              {Object.entries(egg.definition.docker_images).map(([label, value]) => (
                <option key={label} value={String(value)}>
                  {label} · {String(value)}
                </option>
              ))}
            </select>
          </Field>
          {egg.definition.variables.map((v: Row) => (
            <Field key={v.env_variable} label={v.name} hint={v.description}>
              <Input
                name={`eggvar.${v.env_variable}`}
                defaultValue={
                  (defaults.eggId || paperId) === id
                    ? (defaults.variables?.[v.env_variable] ?? v.default_value)
                    : v.default_value
                }
                maxLength={2048}
              />
            </Field>
          ))}
        </div>
      )}
    </div>
  );
}
export function GameStartup({ serviceId }: { serviceId: string }) {
  const q = useData<Row>(`/services/${serviceId}/startup`);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const startup = q.data;
  return (
    <div className="max-w-3xl space-y-5 rounded-xl border bg-card p-6">
      <div>
        <h2 className="font-semibold">{startup.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {startup.currentRelease
            ? `Installed version: ${startup.currentRelease.version} · build ${startup.currentRelease.build}. `
            : ''}
          Changes apply on the next reinstall. A reinstall can replace game files; take a backup
          first.
        </p>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{startup.image}</p>
      </div>
      <Form
        submit="Save startup variables"
        onSubmit={async (f) => {
          await api.patch(`/services/${serviceId}/startup`, {
            variables: Object.fromEntries(
              startup.variables
                .filter((v: Row) => v.editable)
                .map((v: Row) => [v.env_variable, String(f.get(v.env_variable) ?? '')]),
            ),
          });
          await q.mutate();
          toast.success('Variables saved for the next reinstall');
        }}
      >
        {startup.variables.map((v: Row) => (
          <Field key={v.env_variable} label={v.name} hint={v.description}>
            <Input
              name={v.env_variable}
              defaultValue={v.value}
              disabled={!v.editable}
              maxLength={2048}
            />
          </Field>
        ))}
      </Form>
    </div>
  );
}
