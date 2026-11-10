import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Sparkles,
  Layers,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Cpu
} from 'lucide-react';
import { AdminSubTab, NewsTickerDbRow } from '../types.ts';
import { TabAdminEditor } from './TabAdminEditor.tsx';

interface TabAdminProps {
  subTab?: AdminSubTab;
  onSelectSubTab?: (sub: AdminSubTab) => void;
}

type SortColumn =
  | 'index'
  | 'gw'
  | 'id'
  | 'timestamp'
  | 'source'
  | 'status'
  | 'reason'
  | 'phase'
  | 'category'
  | 'subcategory'
  | 'drama'
  | 'poin_tayang'
  | 'headline';

type SortDirection = 'asc' | 'desc';

const TabAdminNewsTable: React.FC = () => {
  const [newsRows, setNewsRows] = useState<NewsTickerDbRow[]>(() => {
    try {
      const cached = sessionStorage.getItem('fnb_news_ticker_admin_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    try {
      const cached = sessionStorage.getItem('fnb_news_ticker_admin_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch {}
    return true;
  });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedGw, setSelectedGw] = useState<string>('ALL');
  const [selectedPhase, setSelectedPhase] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [displayLanguage, setDisplayLanguage] = useState<'id' | 'en'>('id');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('status');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Copied indicator state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch news ticker database table from container with auto-retries and fallback
  const fetchTableData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      if (newsRows.length === 0) setIsLoading(true);
    }
    setError(null);

    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const url = `/api/admin/news-ticker${isManualRefresh ? '?refresh=1' : ''}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
          },
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await res.text();
          console.warn('[TabAdmin] Received non-JSON response:', text.slice(0, 100));
          throw new Error('Server returned HTML instead of JSON. Server might still be initializing.');
        }

        const json = await res.json();
        if (json && Array.isArray(json.data)) {
          setNewsRows(json.data);
          try {
            sessionStorage.setItem('fnb_news_ticker_admin_cache', JSON.stringify(json.data));
          } catch {}
          setError(null);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        } else {
          throw new Error('Invalid data format received from API');
        }
      } catch (err: any) {
        attempt++;
        console.warn(`[TabAdmin] Fetch attempt ${attempt} failed:`, err.message || err);

        if (attempt <= maxRetries) {
          // Retry with backoff: 600ms, 1200ms, 1800ms
          await new Promise((resolve) => setTimeout(resolve, attempt * 600));
        } else {
          // Check if session cache has rows we can show instead of blocking
          try {
            const cached = sessionStorage.getItem('fnb_news_ticker_admin_cache');
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setNewsRows(parsed);
                setError(null);
                console.info('[TabAdmin] Loaded fallback data from session cache after network failure');
                setIsLoading(false);
                setIsRefreshing(false);
                return;
              }
            }
          } catch {}

          console.error('[TabAdmin] Error fetching news table after all retries:', err);
          setError(
            err.name === 'AbortError'
              ? 'Waktu koneksi habis (Request timeout). Sedang mencoba menghubungkan kembali...'
              : 'Gagal terhubung ke database News Ticker (Network Error). Silakan klik Coba Lagi.'
          );
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }
  }, [newsRows.length]);

  useEffect(() => {
    fetchTableData();
  }, [fetchTableData]);

  // Copy text helper
  const handleCopyText = (id: string, text: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (e) {
      console.warn('Clipboard write error:', e);
    }
  };

  // Helper to render text with entity syntax tags ([T:Team], [P:Player], [C:Club], [N:Number])
  const renderFormattedHeadline = (text: string) => {
    if (!text) return null;

    const parts: React.ReactNode[] = [];
    const regex = /\[([TPCN]):([^\]]+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      const tagType = match[1];
      const tagContent = match[2];
      const key = `${match.index}-${tagType}-${tagContent}`;

      switch (tagType) {
        case 'T': // Team Name
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded font-extrabold text-[11px] leading-tight bg-purple-100 dark:bg-purple-950/80 text-[#37003c] dark:text-[#00ff87] border border-purple-200 dark:border-purple-800/60"
            >
              {tagContent}
            </span>
          );
          break;
        case 'P': // Player Name
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded font-bold text-[11px] leading-tight bg-cyan-100 dark:bg-cyan-950/80 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60"
            >
              {tagContent}
            </span>
          );
          break;
        case 'C': // Club
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
            >
              {tagContent}
            </span>
          );
          break;
        case 'N': // Numbers / Metrics
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded font-black text-[11px] bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60"
            >
              {tagContent}
            </span>
          );
          break;
        default:
          parts.push(tagContent);
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return <span>{parts}</span>;
  };

  // KPI Calculations
  const stats = useMemo(() => {
    const total = newsRows.length;
    const active = newsRows.filter((r) => r.status_tayang === 'Y').length;
    const inactive = newsRows.filter((r) => r.status_tayang === 'N').length;
    const ai = newsRows.filter((r) => r.sumber === 'AI').length;
    const nonAi = newsRows.filter((r) => r.sumber === 'Bukan').length;
    return { total, active, inactive, ai, nonAi };
  }, [newsRows]);

  // Unique categories for dropdown filter
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    newsRows.forEach((r) => {
      if (r.kategori) set.add(r.kategori);
    });
    return Array.from(set).sort();
  }, [newsRows]);

  // Unique GWs for dropdown filter
  const gwsList = useMemo(() => {
    const set = new Set<number>();
    newsRows.forEach((r) => {
      const gwNum = Number(r.gw);
      if (!isNaN(gwNum) && gwNum > 0) set.add(gwNum);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [newsRows]);

  // Unique Subcategories for dropdown filter (context-aware: filtered by chosen category if selected)
  const subcategoriesList = useMemo(() => {
    const set = new Set<string>();
    newsRows.forEach((r) => {
      if (selectedCategory !== 'ALL' && r.kategori !== selectedCategory) {
        return;
      }
      if (r.sub_kategori) set.add(r.sub_kategori);
    });
    return Array.from(set).sort();
  }, [newsRows, selectedCategory]);

  // Unique Phases for dropdown filter
  const phasesList = useMemo(() => {
    const defaultPhases = ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'];
    const set = new Set<string>(defaultPhases);
    newsRows.forEach((r) => {
      if (r.fase) set.add(r.fase);
    });
    return Array.from(set);
  }, [newsRows]);

  // Badge classes for Gameweek Phase
  const getPhaseBadgeClasses = (phase?: string) => {
    const p = (phase || '').toLowerCase();
    if (p === 'live match' || p === 'live') {
      return 'inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-black bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60';
    }
    if (p === 'not started') {
      return 'inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60';
    }
    if (p === 'between match') {
      return 'inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60';
    }
    if (p === 'provisional') {
      return 'inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60';
    }
    if (p === 'confirmed') {
      return 'inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-black bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60';
    }
    return 'inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700';
  };

  // Handle column header sort click
  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      // Default to desc for numeric/status/dates, asc for text
      if (col === 'gw' || col === 'timestamp' || col === 'drama' || col === 'index' || col === 'status') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };

  // Sort indicator renderer
  const renderSortIndicator = (col: SortColumn) => {
    if (sortColumn !== col) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400/60 shrink-0 ml-1 group-hover:text-slate-300" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-[#00ff87] shrink-0 ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#00ff87] shrink-0 ml-1" />
    );
  };

  // Filtered & Sorted rows
  const sortedAndFilteredRows = useMemo(() => {
    const filtered = newsRows.filter((row) => {
      // 1. GW filter
      if (selectedGw !== 'ALL' && Number(row.gw) !== Number(selectedGw)) {
        return false;
      }

      // 2. Phase filter
      if (selectedPhase !== 'ALL' && (row.fase || '').toLowerCase() !== selectedPhase.toLowerCase()) {
        return false;
      }

      // 3. Category filter
      if (selectedCategory !== 'ALL' && row.kategori !== selectedCategory) {
        return false;
      }

      // 4. Subcategory filter
      if (selectedSubcategory !== 'ALL' && row.sub_kategori !== selectedSubcategory) {
        return false;
      }

      // 5. Status filter
      if (selectedStatus !== 'ALL' && row.status_tayang !== selectedStatus) {
        return false;
      }

      // 6. Source filter
      if (selectedSource !== 'ALL') {
        const isSysRow = row.sumber === 'Sys' || row.id.startsWith('P1_') || row.id.startsWith('p1_') || row.id.startsWith('LM_') || row.id.startsWith('lm_') || row.id.startsWith('live_score_');
        if (selectedSource === 'Sys') {
          if (!isSysRow) return false;
        } else if (selectedSource === 'AI') {
          if (row.sumber !== 'AI') return false;
        } else {
          if (isSysRow || row.sumber !== selectedSource) return false;
        }
      }

      // 7. Search filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchesId = row.id.toLowerCase().includes(q);
        const matchesTextId = row.text_berita.toLowerCase().includes(q);
        const matchesTextEn = (row.text_berita_en || '').toLowerCase().includes(q);
        const matchesSub = row.sub_kategori.toLowerCase().includes(q);
        const matchesGw = String(row.gw || '').includes(q);
        const matchesPhase = (row.fase || '').toLowerCase().includes(q);
        const matchesTeam = (row.teams || []).some((t) => t.toLowerCase().includes(q));
        const matchesPlayer = (row.players || []).some((p) => p.toLowerCase().includes(q));

        if (!matchesId && !matchesTextId && !matchesTextEn && !matchesSub && !matchesGw && !matchesPhase && !matchesTeam && !matchesPlayer) {
          return false;
        }
      }

      return true;
    });

    // Sorting
    return filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'gw':
          comparison = (Number(a.gw) || 0) - (Number(b.gw) || 0);
          break;
        case 'id':
          comparison = a.id.localeCompare(b.id);
          break;
        case 'timestamp':
          comparison = new Date(a.timestamp_produksi).getTime() - new Date(b.timestamp_produksi).getTime();
          break;
        case 'source':
          comparison = a.sumber.localeCompare(b.sumber);
          break;
        case 'status':
          comparison = a.status_tayang.localeCompare(b.status_tayang);
          break;
        case 'reason':
          comparison = (a.keterangan_tidak_tayang || '').localeCompare(b.keterangan_tidak_tayang || '');
          break;
        case 'phase':
          comparison = (a.fase || '').localeCompare(b.fase || '');
          break;
        case 'category':
          comparison = a.kategori.localeCompare(b.kategori);
          break;
        case 'subcategory':
          comparison = a.sub_kategori.localeCompare(b.sub_kategori);
          break;
        case 'drama':
          comparison = (Number(a.drama_score) || 0) - (Number(b.drama_score) || 0);
          break;
        case 'poin_tayang':
          comparison = (Number(a.poin_tayang) || 0) - (Number(b.poin_tayang) || 0);
          break;
        case 'headline':
          const textA = displayLanguage === 'en' ? (a.text_berita_en || a.text_berita) : a.text_berita;
          const textB = displayLanguage === 'en' ? (b.text_berita_en || b.text_berita) : b.text_berita;
          comparison = textA.localeCompare(textB);
          break;
        case 'index':
        default:
          comparison = 0;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [newsRows, selectedGw, selectedPhase, selectedCategory, selectedSubcategory, selectedStatus, selectedSource, searchTerm, sortColumn, sortDirection, displayLanguage]);

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedGw, selectedPhase, selectedCategory, selectedSubcategory, selectedStatus, selectedSource, searchTerm, pageSize, sortColumn, sortDirection]);

  // Paginated rows
  const paginatedRows = useMemo(() => {
    if (pageSize === -1) return sortedAndFilteredRows;
    const start = (currentPage - 1) * pageSize;
    return sortedAndFilteredRows.slice(start, start + pageSize);
  }, [sortedAndFilteredRows, currentPage, pageSize]);

  const totalPages = pageSize === -1 ? 1 : Math.ceil(sortedAndFilteredRows.length / pageSize) || 1;

  // Format compact timestamp helper
  const formatCompactTimestamp = (iso: string) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear()).slice(-2);
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-3">
      {/* ================= 1. COMPACT KPI & CONTROLS BAR ================= */}
      <div className="bg-white dark:bg-[#190a2a] rounded-xl border border-slate-200 dark:border-purple-900/60 p-3 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Quick Metrics (Compact Pills) */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Total */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/50 text-xs">
              <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-[#00ff87]" />
              <span className="text-slate-500 dark:text-slate-400 font-medium">Total:</span>
              <strong className="text-slate-900 dark:text-white font-black">{stats.total}</strong>
            </div>

            {/* Active (Y) */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-[#00ff87]" />
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">Airing (Y):</span>
              <strong className="text-emerald-700 dark:text-[#00ff87] font-black">{stats.active}</strong>
            </div>

            {/* Inactive (N) */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 text-xs">
              <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span className="text-rose-700 dark:text-rose-300 font-medium">Off Air (N):</span>
              <strong className="text-rose-700 dark:text-rose-300 font-black">{stats.inactive}</strong>
            </div>

            {/* AI */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-[#00ff87]" />
              <span className="text-purple-800 dark:text-purple-300 font-medium">AI:</span>
              <strong className="text-purple-900 dark:text-purple-100 font-black">{stats.ai}</strong>
            </div>

            {/* System */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/50 text-xs">
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-500 dark:text-slate-400 font-medium">System:</span>
              <strong className="text-slate-900 dark:text-white font-black">{stats.nonAi}</strong>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Language toggle for headline preview */}
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-[#10051e] p-0.5 border border-slate-200 dark:border-purple-900/50 text-xs">
              <button
                type="button"
                onClick={() => setDisplayLanguage('id')}
                className={`px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                  displayLanguage === 'id'
                    ? 'bg-white dark:bg-[#37003c] text-purple-950 dark:text-[#00ff87] shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                ID
              </button>
              <button
                type="button"
                onClick={() => setDisplayLanguage('en')}
                className={`px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                  displayLanguage === 'en'
                    ? 'bg-white dark:bg-[#37003c] text-purple-950 dark:text-[#00ff87] shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                EN
              </button>
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => fetchTableData(true)}
              disabled={isRefreshing || isLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#37003c] hover:bg-[#4a0051] text-white text-xs font-bold transition-all shadow-2xs cursor-pointer disabled:opacity-50"
              title="Refresh database table"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Syncing...' : 'Sync'}</span>
            </button>
          </div>
        </div>

        {/* Compact Filters & Search Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-slate-100 dark:border-purple-900/30 text-xs">
          {/* Search box */}
          <div className="relative flex-1 w-full sm:w-auto min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search ID, headline, team, player..."
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* GW Filter */}
          <select
            value={selectedGw}
            onChange={(e) => setSelectedGw(e.target.value)}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All GWs</option>
            {gwsList.map((gw) => (
              <option key={gw} value={gw}>
                GW {gw}
              </option>
            ))}
          </select>

          {/* Phase Filter */}
          <select
            value={selectedPhase}
            onChange={(e) => setSelectedPhase(e.target.value)}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Phases</option>
            {phasesList.map((ph) => (
              <option key={ph} value={ph}>
                {ph}
              </option>
            ))}
          </select>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setSelectedSubcategory('ALL');
            }}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            {categoriesList.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Subcategory Filter */}
          <select
            value={selectedSubcategory}
            onChange={(e) => setSelectedSubcategory(e.target.value)}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Subcategories</option>
            {subcategoriesList.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Status</option>
            <option value="Y">Airing (Y)</option>
            <option value="N">Off Air (N)</option>
          </select>

          {/* Source Filter */}
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Sources</option>
            <option value="Sys">Sys (Editor Template)</option>
            <option value="AI">AI</option>
            <option value="Bukan">Bukan</option>
          </select>

          {/* Page size select */}
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
            <option value={250}>250 / page</option>
            <option value={-1}>All records</option>
          </select>

          {/* Reset Filters button */}
          {(searchTerm || selectedGw !== 'ALL' || selectedPhase !== 'ALL' || selectedCategory !== 'ALL' || selectedSubcategory !== 'ALL' || selectedStatus !== 'ALL' || selectedSource !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSelectedGw('ALL');
                setSelectedPhase('ALL');
                setSelectedCategory('ALL');
                setSelectedSubcategory('ALL');
                setSelectedStatus('ALL');
                setSelectedSource('ALL');
              }}
              className="text-[#37003c] dark:text-[#00ff87] font-bold hover:underline cursor-pointer whitespace-nowrap px-1"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ================= 2. DATA TABLE (1 ROW PER RECORD, NO TEXT WRAP, FULL SORTING) ================= */}
      <div className="bg-white dark:bg-[#190a2a] rounded-xl border border-slate-200 dark:border-purple-900/60 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center space-y-2">
            <RefreshCw className="w-6 h-6 mx-auto text-[#00ff87] animate-spin" />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Loading container news database table...
            </p>
          </div>
        ) : error ? (
          <div className="p-6 text-center space-y-2">
            <XCircle className="w-6 h-6 mx-auto text-rose-500" />
            <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{error}</p>
            <button
              type="button"
              onClick={() => fetchTableData(true)}
              className="px-4 py-1.5 rounded-lg bg-[#37003c] dark:bg-purple-800 text-white hover:bg-[#4d0254] dark:hover:bg-purple-700 text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Coba Lagi (Retry)</span>
            </button>
          </div>
        ) : sortedAndFilteredRows.length === 0 ? (
          <div className="p-10 text-center space-y-1">
            <Search className="w-6 h-6 mx-auto text-slate-400" />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              No news items match the current search or filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="min-w-full text-left border-collapse text-xs select-none">
              {/* Table Header (All sortable with asc/desc toggle) */}
              <thead>
                <tr className="bg-slate-100 dark:bg-[#110520] border-b border-slate-200 dark:border-purple-900/60 text-slate-700 dark:text-purple-200 font-bold uppercase tracking-wider text-[10.5px]">
                  {/* # */}
                  <th
                    onClick={() => handleSort('index')}
                    className="py-2.5 px-2.5 w-10 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Row #"
                  >
                    <div className="flex items-center justify-center">
                      <span>#</span>
                      {renderSortIndicator('index')}
                    </div>
                  </th>

                  {/* GW */}
                  <th
                    onClick={() => handleSort('gw')}
                    className="py-2.5 px-2.5 w-14 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Gameweek"
                  >
                    <div className="flex items-center justify-center">
                      <span>GW</span>
                      {renderSortIndicator('gw')}
                    </div>
                  </th>

                  {/* ID */}
                  <th
                    onClick={() => handleSort('id')}
                    className="py-2.5 px-2.5 min-w-[110px] cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by ID"
                  >
                    <div className="flex items-center">
                      <span>ID</span>
                      {renderSortIndicator('id')}
                    </div>
                  </th>

                  {/* Timestamp */}
                  <th
                    onClick={() => handleSort('timestamp')}
                    className="py-2.5 px-2.5 min-w-[120px] cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Timestamp"
                  >
                    <div className="flex items-center">
                      <span>Timestamp</span>
                      {renderSortIndicator('timestamp')}
                    </div>
                  </th>

                  {/* Source */}
                  <th
                    onClick={() => handleSort('source')}
                    className="py-2.5 px-2 w-20 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Source"
                  >
                    <div className="flex items-center justify-center">
                      <span>Source</span>
                      {renderSortIndicator('source')}
                    </div>
                  </th>

                  {/* Airing Status */}
                  <th
                    onClick={() => handleSort('status')}
                    className="py-2.5 px-2 w-16 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Airing Status (Y/N)"
                  >
                    <div className="flex items-center justify-center">
                      <span>Status</span>
                      {renderSortIndicator('status')}
                    </div>
                  </th>

                  {/* Unpublished Reason */}
                  <th
                    onClick={() => handleSort('reason')}
                    className="py-2.5 px-2.5 min-w-[160px] cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Unpublished Reason"
                  >
                    <div className="flex items-center">
                      <span>Reason</span>
                      {renderSortIndicator('reason')}
                    </div>
                  </th>

                  {/* Gameweek Phase */}
                  <th
                    onClick={() => handleSort('phase')}
                    className="py-2.5 px-2.5 min-w-[120px] cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Gameweek Phase"
                  >
                    <div className="flex items-center">
                      <span>Phase</span>
                      {renderSortIndicator('phase')}
                    </div>
                  </th>

                  {/* Category */}
                  <th
                    onClick={() => handleSort('category')}
                    className="py-2.5 px-2.5 min-w-[130px] cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Category"
                  >
                    <div className="flex items-center">
                      <span>Category</span>
                      {renderSortIndicator('category')}
                    </div>
                  </th>

                  {/* Subcategory */}
                  <th
                    onClick={() => handleSort('subcategory')}
                    className="py-2.5 px-2.5 min-w-[130px] cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Subcategory"
                  >
                    <div className="flex items-center">
                      <span>Subcategory</span>
                      {renderSortIndicator('subcategory')}
                    </div>
                  </th>

                  {/* Drama Score */}
                  <th
                    onClick={() => handleSort('drama')}
                    className="py-2.5 px-2 w-16 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Drama Score"
                  >
                    <div className="flex items-center justify-center">
                      <span>Drama</span>
                      {renderSortIndicator('drama')}
                    </div>
                  </th>

                  {/* Poin Tayang */}
                  <th
                    onClick={() => handleSort('poin_tayang')}
                    className="py-2.5 px-2 w-20 text-center cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Poin Tayang (Frekuensi Tampil di Antrean Ticker)"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Poin Tayang</span>
                      {renderSortIndicator('poin_tayang')}
                    </div>
                  </th>

                  {/* Text Berita (Format News Ticker) */}
                  <th
                    onClick={() => handleSort('headline')}
                    className="py-2.5 px-3 min-w-[340px] cursor-pointer hover:bg-slate-200 dark:hover:bg-purple-950 transition-colors whitespace-nowrap group"
                    title="Sort by Headline Text"
                  >
                    <div className="flex items-center">
                      <span>Headline (News Ticker Format)</span>
                      {renderSortIndicator('headline')}
                    </div>
                  </th>
                </tr>
              </thead>

              {/* Table Body (Strict 1 row per record, no wrapping) */}
              <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30">
                {paginatedRows.map((row, idx) => {
                  const globalIdx = pageSize === -1 ? idx + 1 : (currentPage - 1) * pageSize + idx + 1;
                  const activeText = displayLanguage === 'en' ? (row.text_berita_en || row.text_berita) : row.text_berita;
                  const isCopied = copiedId === row.id;

                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-purple-50/40 dark:hover:bg-purple-950/20 transition-colors h-9 whitespace-nowrap"
                    >
                      {/* 1. # */}
                      <td className="py-2 px-2.5 text-center text-slate-400 dark:text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {globalIdx}
                      </td>

                      {/* 2. GW */}
                      <td className="py-2 px-2.5 text-center font-bold font-mono text-[11px] text-purple-950 dark:text-[#00ff87] whitespace-nowrap">
                        {row.gw ? `GW${row.gw}` : '-'}
                      </td>

                      {/* 3. ID */}
                      <td className="py-2 px-2.5 font-mono text-[11px] text-slate-900 dark:text-slate-200 font-semibold whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span>{row.id}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyText(row.id, row.id)}
                            className="text-slate-400 hover:text-purple-600 dark:hover:text-[#00ff87] p-0.5 cursor-pointer shrink-0"
                            title="Copy ID"
                          >
                            {isCopied ? <Check className="w-3 h-3 text-[#00ff87]" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>

                      {/* 4. Timestamp */}
                      <td className="py-2 px-2.5 text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap font-mono text-[11px]">
                        {formatCompactTimestamp(row.timestamp_produksi)}
                      </td>

                      {/* 5. Source */}
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        {row.sumber === 'AI' ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-[#00ff87] border border-purple-200 dark:border-purple-700/60">
                            <Sparkles className="w-2.5 h-2.5" />
                            AI
                          </span>
                        ) : (row.sumber === 'Sys' || row.id.startsWith('P1_') || row.id.startsWith('p1_') || row.id.startsWith('LM_') || row.id.startsWith('lm_') || row.id.startsWith('live_score_')) ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">
                            Sys
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {row.sumber || 'Bukan'}
                          </span>
                        )}
                      </td>

                      {/* 6. Status */}
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        {row.status_tayang === 'Y' ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full font-black text-xs bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-[#00ff87] border border-emerald-300 dark:border-emerald-700">
                            Y
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full font-bold text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            N
                          </span>
                        )}
                      </td>

                      {/* 7. Reason */}
                      <td className="py-2 px-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                        {row.status_tayang === 'Y' ? (
                          <span className="text-slate-300 dark:text-slate-600 select-none">-</span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400 font-medium text-[11px]" title={row.keterangan_tidak_tayang}>
                            {row.keterangan_tidak_tayang || 'Archived'}
                          </span>
                        )}
                      </td>

                      {/* 8. Phase */}
                      <td className="py-2 px-2.5 whitespace-nowrap">
                        <span className={getPhaseBadgeClasses(row.fase)}>
                          {row.fase || '-'}
                        </span>
                      </td>

                      {/* 13. Category */}
                      <td className="py-2 px-2.5 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        <span className="text-[11px]">{row.kategori}</span>
                      </td>

                      {/* 14. Subcategory */}
                      <td className="py-2 px-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <span className="text-[11px]">{row.sub_kategori}</span>
                      </td>

                      {/* 15. Drama Score */}
                      <td className="py-2 px-2 text-center whitespace-nowrap font-mono font-bold text-[11px]">
                        <span
                          className={
                            row.drama_score >= 90
                              ? 'text-rose-600 dark:text-rose-400'
                              : row.drama_score >= 80
                              ? 'text-purple-600 dark:text-[#00ff87]'
                              : 'text-slate-500'
                          }
                        >
                          {row.drama_score}
                        </span>
                      </td>

                      {/* 16. Poin Tayang */}
                      <td className="py-2 px-2 text-center whitespace-nowrap font-mono font-bold text-[11px]">
                        <span
                          className={
                            (row.poin_tayang ?? 0) > 0
                              ? 'inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-[#37003c] dark:bg-purple-900/60 dark:text-[#00ff87] border border-purple-200 dark:border-purple-700/60'
                              : 'text-slate-400 dark:text-slate-600'
                          }
                          title={`Sudah tayang sebanyak ${row.poin_tayang ?? 0} kali`}
                        >
                          {row.poin_tayang ?? 0}
                        </span>
                      </td>

                      {/* 17. Headline (Fit to longest content without wrap text) */}
                      <td className="py-2 px-3 text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleCopyText(row.id, activeText)}
                            className="p-0.5 rounded text-slate-400 hover:text-purple-600 dark:hover:text-[#00ff87] cursor-pointer shrink-0"
                            title="Copy headline text"
                          >
                            {isCopied ? <Check className="w-3 h-3 text-[#00ff87]" /> : <Copy className="w-3 h-3" />}
                          </button>
                          <div className="whitespace-nowrap font-medium text-[11.5px]" title={activeText}>
                            {renderFormattedHeadline(activeText)}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ================= 3. COMPACT PAGINATION FOOTER ================= */}
        {pageSize !== -1 && sortedAndFilteredRows.length > pageSize && (
          <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-[#120522] border-t border-slate-200 dark:border-purple-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400 font-medium">
              Showing{' '}
              <strong className="text-slate-800 dark:text-white">
                {(currentPage - 1) * pageSize + 1}
              </strong>{' '}
              –{' '}
              <strong className="text-slate-800 dark:text-white">
                {Math.min(currentPage * pageSize, sortedAndFilteredRows.length)}
              </strong>{' '}
              of <strong className="text-slate-800 dark:text-white">{sortedAndFilteredRows.length}</strong> records
            </span>

            <div className="flex items-center gap-1.5 self-center sm:self-auto">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-purple-900/60 bg-white dark:bg-[#1a0b2e] text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <span className="px-2 py-0.5 font-bold text-slate-800 dark:text-white text-xs">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-purple-900/60 bg-white dark:bg-[#1a0b2e] text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const TabAdmin: React.FC<TabAdminProps> = ({ subTab = 'editor', onSelectSubTab }) => {
  if (subTab === 'news-ticker') {
    return <TabAdminNewsTable />;
  }
  return <TabAdminEditor />;
};
