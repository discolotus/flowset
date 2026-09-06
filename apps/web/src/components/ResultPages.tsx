export function ResultPages({ page, total, onChange, label = "Result pages" }: { page: number; total: number; onChange: (page: number) => void; label?: string }) {
  if (total <= 50) return null;
  return <nav aria-label={label} className="my-3 flex items-center gap-3"><button type="button" className="secondary-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button><span>{page * 50 + 1}–{Math.min(total, (page + 1) * 50)} of {total}</span><button type="button" className="secondary-button" disabled={(page + 1) * 50 >= total} onClick={() => onChange(page + 1)}>Next</button></nav>;
}
