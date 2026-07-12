// TODO: Auth and dashboard pages will be implemented in a later phase.
// Expected routes:
//   /login          — LoginForm component
//   /register       — Registration flow
//   /dashboard      — DocumentList component showing user's documents
//   /documents/[id] — Editor component with PresenceAvatars and real-time collaboration

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold tracking-tight">CollabForge</h1>
      <p className="mt-4 text-lg text-gray-500">
        Real-time collaborative document editor — coming soon.
      </p>
    </main>
  );
}
