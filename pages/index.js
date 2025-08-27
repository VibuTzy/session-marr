import React from 'react';
export default function Home() {
  return (
    <main style={{fontFamily: 'system-ui, sans-serif', padding: 24}}>
      <h1>session-marr</h1>
      <p>API route: <code>/api/auth?phone=62...</code></p>
      <p>Deploy note: session files default ke <code>/tmp/sessions</code> (ephemeral pada Vercel).</p>
    </main>
  );
}