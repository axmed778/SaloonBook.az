export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-600">
          SalonBook.az
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
          Müştərilər özləri qeydiyyatdan keçsin — 24/7.
        </h1>
        <p className="mt-4 text-lg text-neutral-500">
          Instagram və WhatsApp-da qeydiyyat mesajlarına cavab verməyi dayandırın.
          Salonunuz üçün şəxsi qeydiyyat linki yaradın və paylaşın.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href="/register"
          className="rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white transition hover:bg-emerald-700"
        >
          Başla
        </a>
        <a
          href="/login"
          className="rounded-lg border border-neutral-300 px-5 py-3 font-medium transition hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Daxil ol
        </a>
        <a
          href="/demostudio"
          className="rounded-lg border border-neutral-300 px-5 py-3 font-medium transition hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Nümunə qeydiyyat səhifəsi
        </a>
      </div>

      <p className="text-xs text-neutral-400">
        MVP scaffold · booking engine + worker + multi-tenant schema in place.
      </p>
    </main>
  );
}
