interface PaginationProps {
  currentPage: number
  totalItems: number
  pageSize?: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalItems, pageSize = 25, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalItems === 0) return null

  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalItems)

  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push('...')
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i)
      }
      if (currentPage < totalPages - 2) pages.push('...')
      if (!pages.includes(totalPages)) pages.push(totalPages)
    }
    return pages
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-line bg-surface rounded-b-lg">
      <div className="font-mono text-[11px] text-[#0f172a] font-medium">
        Showing <span className="font-bold text-[#0f172a]">{startItem}</span> - <span className="font-bold text-[#0f172a]">{endItem}</span> of <span className="font-bold text-[#0f172a]">{totalItems}</span> entries
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-2.5 py-1 rounded font-mono text-xs border border-line text-[#0f172a] font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          Previous
        </button>
        {getPageNumbers().map((p, idx) => (
          typeof p === 'number' ? (
            <button
              key={idx}
              onClick={() => onPageChange(p)}
              className={`min-w-[28px] h-7 px-2 rounded font-mono text-xs font-bold border transition-colors cursor-pointer ${
                currentPage === p
                  ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                  : 'border-line text-[#0f172a] hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          ) : (
            <span key={idx} className="px-1 font-mono text-xs text-[#0f172a] font-bold">...</span>
          )
        ))}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-2.5 py-1 rounded font-mono text-xs border border-line text-[#0f172a] font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  )
}
