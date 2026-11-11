'use client';
import type { FrontendContext } from '@harbor/sdk';
import { frontendModules } from '@/lib/extensions.generated';
import { usePathname } from 'next/navigation';
export function ExtensionLayout(props: FrontendContext) {
  const id = props.settings.themes?.[props.area]?.id;
  const Layout = props.settings.enabledFrontendExtensions?.includes(id)
    ? frontendModules[id]?.ThemeLayout
    : undefined;
  return Layout ? <Layout {...props} /> : <>{props.children}</>;
}
export function ExtensionSlot({ name, ...props }: FrontendContext & { name: string }) {
  return (
    <>
      {Object.entries(frontendModules)
        .filter(([id]) => props.settings.enabledFrontendExtensions?.includes(id))
        .map(([id, module]) => {
          const Slot = module.slots?.[name];
          return Slot ? <Slot key={id} {...props} /> : null;
        })}
    </>
  );
}
export function extensionPages(settings: Record<string, any>) {
  return Object.entries(frontendModules)
    .filter(([id]) => settings.enabledFrontendExtensions?.includes(id))
    .flatMap(([id, module]) =>
      Object.entries(module.pages || {}).map(([slug, page]) => ({
        ...page,
        href: `/extensions/${id}/${slug}`,
      })),
    );
}
export function ExtensionPage(props: FrontendContext) {
  const path = usePathname();
  const page = extensionPages(props.settings).find((p) => p.href === path);
  return page ? <page.Component {...props} /> : null;
}
