interface FilterChip {
  label: string;
  value: string;
}

interface FilterChipsProps {
  filters: FilterChip[];
  onRemove: (label: string, value: string) => void;
  onClearAll: () => void;
}

export function FilterChips({ filters, onRemove, onClearAll }: FilterChipsProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-3">
      {filters.map((f) => (
        <span
          key={`${f.label}:${f.value}`}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-400"
        >
          {f.label}: {f.value}
          <button
            onClick={() => onRemove(f.label, f.value)}
            className="text-zinc-600 hover:text-zinc-300 font-bold ml-0.5"
          >
            &times;
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="text-xs text-zinc-600 hover:text-zinc-400 ml-1"
      >
        Clear all
      </button>
    </div>
  );
}
