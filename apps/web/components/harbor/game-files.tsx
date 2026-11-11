'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { File, Folder, MoreHorizontal, Upload, Download, RefreshCw, Plus } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Panel, Field, Input, Form, Modal, DataTable, Loading, ErrorBox, type Row } from './shared';
const maxUpload = 100 * 1024 * 1024;
const childPath = (root: string, name: string) => `${root === '/' ? '' : root}/${name}`;
export function GameFileManager({
  serviceId,
  onEdit,
}: {
  serviceId: string;
  onEdit: (file: Row) => void;
}) {
  const [directory, setDirectory] = useState('/'),
    [files, setFiles] = useState<Row[] | null>(null),
    [error, setError] = useState<Error | null>(null),
    [modal, setModal] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [upload, setUpload] = useState<{ name: string; percent: number } | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null),
    request = useRef<XMLHttpRequest | null>(null),
    generation = useRef(0);
  useEffect(() => () => request.current?.abort(), []);
  const load = async (path = directory) => {
    const revision = ++generation.current;
    setError(null);
    try {
      const data = await api.post<Row>(`/services/${serviceId}/actions`, {
        action: 'files.list',
        path,
      });
      if (revision === generation.current) {
        setFiles(data.entries);
        setDirectory(path);
        setSelected([]);
      }
    } catch (e) {
      if (revision === generation.current)
        setError(e instanceof Error ? e : new Error(getErrorMessage(e)));
    }
  };
  useEffect(() => {
    void load('/');
  }, [serviceId]);
  const operate = async (action: string, fields: Row = {}) => {
    await api.post(`/services/${serviceId}/files/operations`, { action, directory, ...fields });
    await load();
  };
  const edit = async (file: Row) => {
    const path = childPath(directory, file.name);
    if (file.type === 'directory') return load(path);
    if (
      file.size > 1048576 ||
      /\.(jar|zip|gz|tar|7z|png|jpe?g|gif|webp|ico|pdf|db|sqlite|mca|dat|class|so|bin)$/i.test(
        file.name,
      )
    ) {
      toast.info('Use Download for binary files or files larger than 1 MB');
      return;
    }
    try {
      const result = await api.get<Row>(
        `/services/${serviceId}/files/content?path=${encodeURIComponent(path)}`,
      );
      onEdit({ path, content: result.content });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };
  const uploadFiles = async (chosen: FileList | null) => {
    if (!chosen?.length || upload) return;
    const targetDirectory = directory;
    for (const file of Array.from(chosen)) {
      if (file.size > maxUpload) {
        toast.error(`${file.name} exceeds the 100 MB upload limit`);
        continue;
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          request.current = xhr;
          xhr.open(
            'POST',
            `/api/v1/services/${serviceId}/files/upload?directory=${encodeURIComponent(targetDirectory)}`,
          );
          xhr.timeout = 5 * 60000;
          xhr.upload.onprogress = (e) =>
            setUpload({
              name: file.name,
              percent: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : 0,
            });
          xhr.onload = () => {
            let payload: any;
            try {
              payload = JSON.parse(xhr.responseText);
            } catch {}
            if (xhr.status >= 200 && xhr.status < 300 && payload?.data?.uploaded) resolve();
            else reject(new Error(payload?.error?.message || `Upload failed (HTTP ${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error('Upload connection failed'));
          xhr.ontimeout = () => reject(new Error('Upload timed out'));
          xhr.onabort = () => reject(new Error('Upload cancelled'));
          const body = new FormData();
          body.append('file', file);
          setUpload({ name: file.name, percent: 0 });
          xhr.send(body);
        });
        toast.success(`${file.name} uploaded`);
      } catch (e) {
        toast.error(getErrorMessage(e));
        break;
      }
    }
    request.current = null;
    setUpload(null);
    if (input.current) input.current.value = '';
    await load(targetDirectory);
  };
  const action = (name: string, fields: Row) => {
    setBusy(true);
    void operate(name, fields)
      .then(() => toast.success('File operation complete'))
      .catch((e) => toast.error(getErrorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Panel
      title="File manager"
      description="Upload files up to 100 MB each. Uploads replace files with matching names. Downloads stream directly from your node. SFTP is available for larger transfers."
      action={
        <div className="harbor-file-actions grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !!upload}
            onClick={() => void load()}
            aria-label="Refresh files"
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!upload}
            onClick={() => input.current?.click()}
          >
            <Upload className="size-4" />
            Upload
          </Button>
          <Button size="sm" onClick={() => setModal({ action: 'create-file' })}>
            <Plus className="size-4" />
            New file
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModal({ action: 'create-folder' })}>
            New folder
          </Button>
        </div>
      }
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Upload game files"
        onChange={(e) => void uploadFiles(e.target.files)}
      />
      {upload && (
        <div className="mb-4 rounded-lg border p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span>
              {upload.name} · {upload.percent === 100 ? 'Saving on node…' : `${upload.percent}%`}
            </span>
            <button onClick={() => request.current?.abort()} className="underline">
              Cancel upload
            </button>
          </div>
          <progress className="mt-2 h-2 w-full" value={upload.percent} max={100} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={directory === '/'}
          onClick={() => void load(directory.split('/').slice(0, -1).join('/') || '/')}
        >
          Up
        </Button>
        <button className="text-xs text-primary" onClick={() => void load('/')}>
          Root
        </button>
        <code className="break-all text-xs text-muted-foreground">{directory}</code>
        {selected.length > 0 && (
          <>
            <span className="text-xs">{selected.length} selected</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => action('compress', { files: selected })}
            >
              Create archive
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setModal({ action: 'delete', files: selected })}
            >
              Delete selected
            </Button>
          </>
        )}
      </div>
      {error ? (
        <ErrorBox error={error} retry={() => void load()} />
      ) : !files ? (
        <Loading />
      ) : (
        <DataTable
          mobileLayout="files"
          rows={files}
          empty="This directory is empty"
          columns={[
            {
              label: 'Select',
              render: (f) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${f.name}`}
                  checked={selected.includes(f.name)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, f.name] : old.filter((n) => n !== f.name),
                    )
                  }
                />
              ),
            },
            {
              label: 'Name',
              render: (f) => (
                <button
                  className="flex items-center gap-2 text-sm hover:text-primary"
                  onClick={() => void edit(f)}
                >
                  {f.type === 'directory' ? (
                    <Folder className="size-4 text-primary" />
                  ) : (
                    <File className="size-4 text-muted-foreground" />
                  )}
                  {f.name}
                </button>
              ),
            },
            {
              label: 'Size',
              render: (f) => (
                <span className="text-xs text-muted-foreground">
                  {f.type === 'directory'
                    ? 'Folder'
                    : f.size >= 1048576
                      ? `${(f.size / 1048576).toFixed(1)} MB`
                      : `${(f.size / 1024).toFixed(1)} KB`}
                </span>
              ),
            },
            {
              label: 'Actions',
              render: (f) => (
                <div className="flex items-center justify-end gap-1">
                  {f.type !== 'directory' && (
                    <Button asChild size="icon" variant="ghost">
                      <a
                        href={`/api/v1/services/${serviceId}/files/download?path=${encodeURIComponent(childPath(directory, f.name))}`}
                        download
                        aria-label={`Download ${f.name}`}
                      >
                        <Download className="size-4" />
                      </a>
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`Actions for ${f.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setModal({ action: 'rename', name: f.name })}
                      >
                        Rename
                      </DropdownMenuItem>
                      {f.type !== 'directory' && (
                        <DropdownMenuItem onSelect={() => action('copy', { name: f.name })}>
                          Duplicate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => action('compress', { files: [f.name] })}>
                        Create archive
                      </DropdownMenuItem>
                      {/\.(zip|tar|tar\.gz|tgz|gz)$/i.test(f.name) && (
                        <DropdownMenuItem
                          onSelect={() => setModal({ action: 'decompress', name: f.name })}
                        >
                          Extract archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => setModal({ action: 'delete', files: [f.name] })}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ),
            },
          ]}
        />
      )}
      {modal && (
        <Modal
          title={
            (
              {
                'create-file': 'Create file',
                'create-folder': 'Create folder',
                rename: 'Rename item',
                delete: 'Delete files',
                decompress: 'Extract archive',
              } as Row
            )[modal.action]
          }
          description={
            modal.action === 'delete'
              ? `Permanently delete ${modal.files.join(', ')} from ${directory}. Folders include all their contents.`
              : modal.action === 'decompress'
                ? 'Extract into the current directory. Files with matching names may be replaced.'
                : `Directory: ${directory}`
          }
          close={() => setModal(null)}
        >
          <Form
            submit={
              modal.action === 'delete'
                ? 'Delete permanently'
                : modal.action === 'decompress'
                  ? 'Extract'
                  : 'Save'
            }
            onSubmit={async (f) => {
              if (modal.action === 'create-file') {
                const name = String(f.get('name'));
                if (!name || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name))
                  throw new Error('Use a single file name');
                await operate('create-file', { name });
              } else
                await operate(
                  modal.action,
                  modal.action === 'delete'
                    ? { files: modal.files, confirmation: 'DELETE' }
                    : modal.action === 'rename'
                      ? { name: modal.name, target: String(f.get('name')) }
                      : modal.action === 'decompress'
                        ? { name: modal.name }
                        : { name: String(f.get('name')) },
                );
              setModal(null);
              await load();
              toast.success('File operation complete');
            }}
          >
            {!['delete', 'decompress'].includes(modal.action) && (
              <Field label={modal.action === 'create-folder' ? 'Folder name' : 'File name'}>
                <Input
                  name="name"
                  defaultValue={modal.name || ''}
                  required
                  maxLength={255}
                  autoFocus
                />
              </Field>
            )}
          </Form>
        </Modal>
      )}
    </Panel>
  );
}
