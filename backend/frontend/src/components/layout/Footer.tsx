/** Standing disclaimer plus build information. */
export function Footer() {
  return (
    <footer className="border-t border-slate-200 px-4 py-5 sm:px-6 dark:border-slate-800">
      <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
        <p>
          ระบบต้นแบบสำหรับงานวิจัย — ผลลัพธ์ไม่ใช่การวินิจฉัยทางการแพทย์
        </p>
        <p className="shrink-0">
          Alzheimer Eye-Tracking Risk · เอกสาร API ที่{" "}
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
          >
            /docs
          </a>
        </p>
      </div>
    </footer>
  );
}
