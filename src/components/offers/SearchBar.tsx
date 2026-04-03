/**
 * Product search bar with debounced input.
 */

import { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'ابحث عن منتج...' }: SearchBarProps) {
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(timer);
  }, [local, value, onChange]);

  const handleClear = useCallback(() => {
    setLocal('');
    onChange('');
  }, [onChange]);

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <Search
        className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="pr-10 pl-10 h-12 text-base rounded-xl border-border bg-card shadow-sm
                   focus:ring-2 focus:ring-primary/30 focus:border-primary
                   placeholder:text-muted-foreground/60"
        aria-label="بحث عن منتج"
      />
      {local && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClear}
          className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="مسح البحث"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
