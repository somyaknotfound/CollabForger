import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold tracking-tight">CollabForge</h1>
      <p className="mt-4 text-lg text-gray-500">
        Real-time collaborative document editor — coming soon.
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/login"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Log in
        </Link>
        <Link
          href="/register"
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Register
        </Link>
      </div>
    </main>
  );
}
