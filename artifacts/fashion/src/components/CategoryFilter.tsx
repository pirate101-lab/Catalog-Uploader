import { CATEGORIES } from '@/data/products';

interface CategoryFilterProps {
  active: string;
  onChange: (category: string) => void;
}

export function CategoryFilter({ active, onChange }: CategoryFilterProps) {
  const tabs = ['All', ...CATEGORIES];
  return (
    <div className="flex flex-wrap justify-center gap-2 md:gap-3">
      {tabs.map((category) => (
        <button
          key={category}
          onClick={() => onChange(category)}
          className={`px-6 py-2.5 rounded-full text-xs tracking-widest uppercase font-semibold transition-all ${
            active === category
              ? 'bg-primary text-white shadow-md'
              : 'bg-muted text-foreground hover:bg-zinc-200 dark:text-muted-foreground dark:hover:bg-gray-800 border border-border'
          }`}
        >
          {category}
        </button>
      ))}
    </div>
  );
}
