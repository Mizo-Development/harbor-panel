'use client';
import {useState} from 'react';
import type {HarborFrontendModule,FrontendContext} from '@harbor/sdk';
function HelloPage({user}:FrontendContext){
 const[message,setMessage]=useState('');
 return <section className="rounded-xl border bg-card p-6"><h1 className="text-xl font-semibold">Hello, {user?.name||'Harbor'}.</h1><p className="mt-3 text-sm text-muted-foreground">This page was installed as a plugin.</p><button className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={async()=>{try{const response=await fetch('/api/v1/extensions/hello-world/routes/hello',{credentials:'same-origin'});const body=await response.json();if(!response.ok)throw new Error(body.error?.message);setMessage(body.data.message);}catch(error){setMessage(error instanceof Error?error.message:'Request failed');}}}>Call plugin API</button><p role="status" className="mt-4 text-sm">{message}</p></section>;
}
export const pages:HarborFrontendModule['pages']={hello:{area:'customer',label:'Hello Harbor',Component:HelloPage}};
