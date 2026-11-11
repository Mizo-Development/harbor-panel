'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useTheme } from 'next-themes';

import { useSettings } from '@/lib/hooks';
import type { ThemeArea } from '@/lib/types';

const TOKEN_NAME = /^--[a-z0-9-]{1,48}$/;
const TOKEN_VALUE = /^[#a-zA-Z0-9%.,()\s/-]{1,96}$/;

function areaFromPath(pathname: string): ThemeArea {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/store' || pathname.startsWith('/store/')) return 'storefront';
  return 'customer';
}

function toDeclarations(tokens: Record<string, string> | undefined): string {
  if (!tokens) return '';
  return Object.entries(tokens)
    .filter(([name, value]) => TOKEN_NAME.test(name) && TOKEN_VALUE.test(value))
    .map(([name, value]) => `${name}:${value};`)
    .join('');
}

/**
 * Applies the active theme for the current area (admin, customer or storefront).
 * Tokens come from the settings API and are validated before being written to a style tag.
 * If settings cannot be loaded, the built-in Harbor theme stays in place.
 */
export function ThemeStyles() {
  const pathname = usePathname();
  const { data } = useSettings();
  const { setTheme } = useTheme();
  const settings = data as any,
    experience = settings?.experience;
  useEffect(() => {
    if (!settings) return;
    document.title = experience?.siteTitle || settings.companyName || 'Harbor';
    document.documentElement.lang = experience?.defaultLocale?.split('-')[0] || 'en';
    document.documentElement.dataset.locale = experience?.defaultLocale || 'en-US';
    document.documentElement.dataset.harborDensity =
      experience?.appearance?.density || 'comfortable';
    document.documentElement.dataset.harborMotion = experience?.appearance?.motion || 'system';
    try {
      const source = localStorage.getItem('harbor-theme-source');
      if (!source && localStorage.getItem('harbor-theme-v2'))
        localStorage.setItem('harbor-theme-source', 'manual');
      else if (source !== 'manual') {
        localStorage.setItem('harbor-theme-source', 'default');
        setTheme(experience?.appearance?.defaultTheme || 'dark');
      }
    } catch {}
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      icon.href = settings.logoUrl || '/icon.svg';
      icon.type = settings.logoUrl ? '' : 'image/svg+xml';
    }
  }, [settings?.companyName, settings?.logoUrl, experience, setTheme, pathname]);

  const selection = data?.themes?.[areaFromPath(pathname)];
  const brand = (data as any)?.accentColor;
  const accent: Record<string, string> =
    typeof brand === 'string' && /^#[a-f0-9]{6}$/i.test(brand)
      ? { '--primary': brand, '--ring': brand, '--sidebar-primary': brand }
      : {};
  if (accent['--primary']) {
    const rgb = [1, 3, 5]
      .map((start) => parseInt(brand.slice(start, start + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const foreground =
      rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#09090b' : '#fafafa';
    accent['--primary-foreground'] = foreground;
    accent['--sidebar-primary-foreground'] = foreground;
  }
  const radius = (
    { none: '0rem', sm: '0.4rem', md: '0.625rem', lg: '0.9rem' } as Record<string, string>
  )[experience?.appearance?.radius];
  if (radius) accent['--radius'] = radius;
  const light = toDeclarations({ ...selection?.tokens?.light, ...accent });
  const dark = toDeclarations({ ...selection?.tokens?.dark, ...accent });

  if (!light && !dark) return null;

  const css = `${light ? `:root:not(.dark){${light}}` : ''}${dark ? `.dark{${dark}}` : ''}`;
  return <style id="harbor-active-theme" dangerouslySetInnerHTML={{ __html: css }} />;
}
