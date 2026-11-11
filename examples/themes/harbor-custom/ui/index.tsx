'use client';
import type {FrontendContext} from '@harbor/sdk';
// You can replace children completely to implement a different layout.
// Core authentication and ownership checks remain enforced by the backend.
export function ThemeLayout({children,area}:FrontendContext){return <div data-harbor-theme="midnight" data-area={area} className="min-h-dvh"><div className="h-1 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-violet-500"/>{children}</div>;}
