import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface PopoverOption<T extends string | number = string | number> {
  value: T;
  label: string;
  sublabel?: string;
}

interface CustomPopoverSelectProps<T extends string | number> {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  options: PopoverOption<T>[];
  placeholder?: string;
  className?: string;
  dropdownClassName?: string;
  align?: 'left' | 'right' | 'center';
  variant?: 'light' | 'dark';
  searchable?: boolean;
  disabled?: boolean;
  hideChevron?: boolean;
  customTrigger?: (options: { isOpen: boolean; displayLabel: string; value: T }) => React.ReactNode;
}

export function CustomPopoverSelect<T extends string | number>({
  id,
  value,
  onChange,
  options,
  placeholder,
  className = '',
  dropdownClassName = '',
  align = 'left',
  variant = 'light',
  searchable,
  disabled = false,
  hideChevron = false,
  customTrigger,
}: CustomPopoverSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => String(opt.value) === String(value)),
    [options, value]
  );

  const displayLabel = selectedOption ? selectedOption.label : placeholder || String(value);

  const isSearchActive = searchable ?? options.length > 12;

  const filteredOptions = useMemo(() => {
    if (!isSearchActive || !search.trim()) return options;
    const lower = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(lower))
    );
  }, [options, isSearchActive, search]);

  // Reset search when closed
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
    }
  }, [isOpen]);

  const isDark = variant === 'dark';

  return (
    <div className="relative inline-block text-left" ref={popoverRef} id={id}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={
          className ||
          (isDark
            ? 'bg-[#24002b] text-[#00ff87] text-xs font-black px-2.5 py-1.5 rounded-lg border border-purple-500/40 hover:border-[#00ff87]/60 flex items-center justify-between gap-1.5 cursor-pointer shadow-xs focus:outline-none transition-colors'
            : 'bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-2.5 shadow-2xs flex items-center justify-between gap-1.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors')
        }
      >
        {customTrigger ? (
          customTrigger({ isOpen, displayLabel, value })
        ) : (
          <>
            <span className="truncate">{displayLabel}</span>
            {!hideChevron && (
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                  isDark ? 'text-purple-400' : 'text-slate-500 dark:text-slate-400'
                } ${isOpen ? 'rotate-180' : ''}`}
              />
            )}
          </>
        )}
      </button>

      {isOpen && (
        <>
          {/* Invisible Backdrop for outside click */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Floating Dropdown Card */}
          <div
            className={`absolute ${
              align === 'right'
                ? 'right-0'
                : align === 'center'
                ? 'left-1/2 -translate-x-1/2'
                : 'left-0'
            } mt-1.5 min-w-[130px] max-w-xs ${
              isDark
                ? 'bg-[#1e0024] border border-purple-800/80 text-white shadow-2xl'
                : 'bg-white dark:bg-[#190a2a] border border-slate-200 dark:border-purple-800/80 text-slate-800 dark:text-slate-100 shadow-2xl'
            } rounded-xl z-50 p-1.5 animate-in fade-in zoom-in-95 space-y-0.5 max-h-64 overflow-y-auto ${dropdownClassName}`}
          >
            {isSearchActive && (
              <div className="p-1 border-b border-slate-100 dark:border-purple-900/50 mb-1 sticky top-0 bg-inherit z-10">
                <div className="relative">
                  <Search className="w-3 h-3 text-slate-400 dark:text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={`w-full text-xs pl-6 pr-2 py-1 rounded-md border focus:outline-none ${
                      isDark
                        ? 'bg-purple-950/70 border-purple-800 text-white placeholder-purple-400 focus:ring-1 focus:ring-[#00ff87]'
                        : 'bg-slate-50 dark:bg-purple-950/40 border-slate-200 dark:border-purple-800/60 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-purple-600 dark:focus:ring-[#00ff87]'
                    }`}
                    autoFocus
                  />
                </div>
              </div>
            )}

            {filteredOptions.length === 0 ? (
              <div className="p-2 text-center text-xs text-slate-400 dark:text-slate-500">
                No options found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer gap-2 ${
                      isDark
                        ? isSelected
                          ? 'bg-[#37003c] text-[#00ff87] font-black'
                          : 'text-purple-200 hover:bg-purple-900/40 hover:text-white'
                        : isSelected
                        ? 'bg-purple-50 dark:bg-purple-900/60 text-purple-900 dark:text-[#00ff87] font-bold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/30 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span
                        className={`text-[10px] font-bold shrink-0 ${
                          opt.sublabel === 'Live'
                            ? 'text-[#ff2851]'
                            : isDark
                            ? 'text-purple-400 font-mono'
                            : 'text-slate-400 dark:text-purple-400/80 font-mono'
                        }`}
                      >
                        {opt.sublabel}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
