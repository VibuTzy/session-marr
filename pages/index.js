export default function Home() {
  return (
    <main style={{fontFamily: 'system-ui, sans-serif', padding: 24}}>
      <h1>session-marr</h1>
      <p>API route: <code>/api/auth?phone=62...</code></p>
      <p>Deploy notes: session files are stored under <code>/tmp/sessions</code> by default (ephemeral on Vercel).</p>
    </main>
  );
}