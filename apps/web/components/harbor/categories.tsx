'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  Header,
  Field,
  Input,
  Select,
  Form,
  Modal,
  DataTable,
  Loading,
  ErrorBox,
  useData,
  type Row,
} from './shared';

export function categoryPath(category: Row, categories: Row[]): string {
  const parts = [category.name];
  const seen = new Set([category.id]);
  let parent = categories.find((c) => c.id === category.parentId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    parts.unshift(parent.name);
    parent = categories.find((c) => c.id === parent!.parentId);
  }
  return parts.join(' / ');
}
export function CatalogCategories() {
  const q = useData<Row[]>('/catalog/categories');
  const [edit, setEdit] = useState<Row | null>(null);
  return (
    <>
      <Header
        eyebrow="Catalog"
        title="Categories"
        description="Organize your storefront. Hiding a category also hides its descendants and prevents new orders for their plans."
        action={<Button onClick={() => setEdit({})}>Create category</Button>}
      />
      {q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Loading />
      ) : (
        <DataTable
          rows={q.data}
          empty="No categories yet."
          columns={[
            {
              label: 'Category',
              render: (c) => (
                <div>
                  <p className="font-medium">{categoryPath(c, q.data!)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                </div>
              ),
            },
            { label: 'Slug', render: (c) => c.slug },
            {
              label: 'Visibility',
              render: (c) => (c.active ? 'Visible when parent is visible' : 'Hidden'),
            },
            { label: 'Order', render: (c) => c.position },
            {
              label: 'Actions',
              render: (c) => (
                <Button variant="outline" size="sm" onClick={() => setEdit(c)}>
                  Edit category
                </Button>
              ),
            },
          ]}
        />
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit category' : 'Create category'} close={() => setEdit(null)}>
          <Form
            submit="Save category"
            onSubmit={async (f) => {
              const data = {
                name: f.get('name'),
                slug: f.get('slug'),
                description: f.get('description'),
                parentId: f.get('parentId') || null,
                position: Number(f.get('position')),
                active: f.get('active') === 'on',
              };
              if (edit.id) await api.patch(`/catalog/categories/${edit.id}`, data);
              else await api.post('/catalog/categories', data);
              await q.mutate();
              setEdit(null);
              toast.success('Category saved');
            }}
          >
            <Field label="Category name">
              <Input name="name" defaultValue={edit.name} required maxLength={100} />
            </Field>
            <Field label="Category slug">
              <Input
                name="slug"
                defaultValue={edit.slug}
                placeholder="minecraft-servers"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                required
                maxLength={100}
              />
            </Field>
            <Field label="Description">
              <Input name="description" defaultValue={edit.description || ''} maxLength={2000} />
            </Field>
            <Field label="Parent category">
              <Select name="parentId" defaultValue={edit.parentId || ''}>
                <option value="">Top level</option>
                {q.data
                  ?.filter((c) => c.id !== edit.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryPath(c, q.data!)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Display order">
              <Input
                name="position"
                type="number"
                min={0}
                max={10000}
                defaultValue={edit.position || 0}
                required
              />
            </Field>
            <label className="flex gap-2 text-sm">
              <input name="active" type="checkbox" defaultChecked={edit.active ?? true} />
              Visible in storefront
            </label>
          </Form>
        </Modal>
      )}
    </>
  );
}
