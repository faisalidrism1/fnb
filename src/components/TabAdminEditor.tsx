import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Sliders,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Save,
  Search,
  Filter,
  Eye,
  Layers,
  Cpu,
  Flame,
  Check,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { NewsFormulaItem, NewsAiringPhase, NewsFormulaSource } from '../types.ts';

const AIRING_PHASES: { id: NewsAiringPhase; label: string; desc: string; color: string }[] = [
  { id: 'Not started', label: 'Not started', desc: 'Pra-pekan sebelum kickoff match pertama', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700' },
  { id: 'Live Match', label: 'Live Match', desc: 'Pertandingan sedang aktif di lapangan', color: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800' },
  { id: 'Between Match', label: 'Between Match', desc: 'Jeda istirahat antar-pertandingan', color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800' },
  { id: 'Provisional', label: 'Provisional', desc: 'Laga usai, menunggu audit Opta & autosub', color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800' },
  { id: 'Confirmed', label: 'Confirmed', desc: 'Poin sah & klasemen liga dikunci resmi', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800' },
];

export const TabAdminEditor: React.FC = () => {
  const [formulas, setFormulas] = useState<NewsFormulaItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSuccessId, setSavedSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedSource, setSelectedSource] = useState<'ALL' | NewsFormulaSource>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedPhase, setSelectedPhase] = useState<'ALL' | NewsAiringPhase>('ALL');

  // Preview Mode State per formula (live vs confirmed)
  const [previewModes, setPreviewModes] = useState<Record<string, 'live' | 'confirmed'>>({});
  // Interactive Simulator Metric Slider values per formula
  const [simulatorValues, setSimulatorValues] = useState<Record<string, number>>({});
  // Expanded calibration settings state per formula
  const [expandedCalibrations, setExpandedCalibrations] = useState<Record<string, boolean>>({});

  // Fetch formulas from API
  const fetchFormulas = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/news-formulas');
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch news formulas`);
      const json = await res.json();
      if (json && Array.isArray(json.data)) {
        setFormulas(json.data);

        // Pre-populate simulator values with default metric values
        const initialSim: Record<string, number> = {};
        json.data.forEach((f: NewsFormulaItem) => {
          initialSim[f.id] = f.drama_config?.metric_default ?? 5;
        });
        setSimulatorValues(initialSim);
      }
    } catch (err: any) {
      console.error('[TabAdminEditor] Fetch error:', err);
      setError(err?.message || 'Gagal memuat katalog formula');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFormulas();
  }, [fetchFormulas]);

  // Categories list derived from current formulas
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    formulas.forEach((f) => {
      if (f.kategori) set.add(f.kategori);
    });
    return Array.from(set).sort();
  }, [formulas]);

  // Filtered formulas
  const filteredFormulas = useMemo(() => {
    return formulas.filter((f) => {
      if (selectedSource !== 'ALL' && f.source !== selectedSource) return false;
      if (selectedCategory !== 'ALL' && f.kategori !== selectedCategory) return false;
      if (selectedPhase !== 'ALL' && !f.allowed_phases.includes(selectedPhase)) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          f.id.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.sub_kategori.toLowerCase().includes(q) ||
          f.kategori.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [formulas, selectedSource, selectedCategory, selectedPhase, searchTerm]);

  // Toggle airing phase on a formula
  const handleTogglePhase = (formulaId: string, phase: NewsAiringPhase) => {
    setFormulas((prev) =>
      prev.map((f) => {
        if (f.id !== formulaId) return f;

        // Strict rule: if mentions points or rank, Not started cannot be enabled
        if (phase === 'Not started' && f.mentions_points_or_rank) {
          return f; // disallowed
        }

        const exists = f.allowed_phases.includes(phase);
        let newPhases: NewsAiringPhase[];
        if (exists) {
          // Cannot remove if it's the last remaining phase
          if (f.allowed_phases.length <= 1) return f;
          newPhases = f.allowed_phases.filter((p) => p !== phase);
        } else {
          newPhases = [...f.allowed_phases, phase];
        }

        return { ...f, allowed_phases: newPhases };
      })
    );
  };

  // Update drama config field
  const handleUpdateDramaConfig = (
    formulaId: string,
    field: 'base_score' | 'min_cap' | 'max_cap' | 'metric_multiplier',
    value: number
  ) => {
    setFormulas((prev) =>
      prev.map((f) => {
        if (f.id !== formulaId) return f;
        return {
          ...f,
          drama_config: {
            ...f.drama_config,
            [field]: value,
          },
        };
      })
    );
  };

  // Save specific formula to server
  const handleSaveFormula = async (formula: NewsFormulaItem) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/news-formulas/${formula.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formula),
      });
      if (!res.ok) throw new Error('Gagal menyimpan formula');
      setSavedSuccessId(formula.id);
      setTimeout(() => setSavedSuccessId(null), 2500);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Reset to default
  const handleResetDefaults = async () => {
    if (!window.confirm('Kembalikan seluruh konfigurasi formula & drama score ke pengaturan default?')) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/news-formulas/reset', { method: 'POST' });
      if (!res.ok) throw new Error('Gagal mereset ke default');
      await fetchFormulas();
    } catch (err: any) {
      alert(`Reset error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to calculate drama score dynamically on client
  const computeClientDramaScore = (formula: NewsFormulaItem, metricVal: number): number => {
    const cfg = formula.drama_config;
    const raw = Math.round(cfg.base_score + metricVal * (cfg.metric_multiplier ?? 1));
    return Math.max(cfg.min_cap, Math.min(cfg.max_cap, raw));
  };

  // Render formatted headline with tag colors
  const renderTaggedHeadline = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\[[TPCN]:[^\]]+\])/g);
    return parts.map((part, idx) => {
      if (part.startsWith('[T:') && part.endsWith(']')) {
        return (
          <span key={idx} className="font-bold text-emerald-600 dark:text-[#00ff87]">
            {part.slice(3, -1)}
          </span>
        );
      }
      if (part.startsWith('[P:') && part.endsWith(']')) {
        return (
          <span key={idx} className="font-bold text-cyan-600 dark:text-cyan-400">
            {part.slice(3, -1)}
          </span>
        );
      }
      if (part.startsWith('[C:') && part.endsWith(']')) {
        return (
          <span key={idx} className="font-bold text-amber-600 dark:text-amber-400">
            {part.slice(3, -1)}
          </span>
        );
      }
      if (part.startsWith('[N:') && part.endsWith(']')) {
        return (
          <span key={idx} className="font-bold text-purple-600 dark:text-purple-300">
            {part.slice(3, -1)}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ================= 1. HEADER & CONTROL BANNER ================= */}
      <div className="bg-white dark:bg-[#1a0b2e] rounded-xl border border-slate-200 dark:border-purple-900/60 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 sm:p-3 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-md shrink-0">
              <Sliders className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  Editor Formula & Drama Score
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  {formulas.length} Formula Terdaftar
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Kelola waktu tayang gameweek (Live vs Confirmed) dan kalibrasi otomatis formula drama score FPL.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto flex-wrap">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-purple-900/60 bg-slate-50 dark:bg-purple-950/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/60 text-xs font-semibold transition-colors cursor-pointer"
              title="Reset seluruh formula ke konfigurasi awal"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              Reset Default
            </button>
            <button
              type="button"
              onClick={fetchFormulas}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Sinkronisasi
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-purple-900/40">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari nama, ID, atau kata kunci..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/60 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          {/* Filter Source */}
          <div>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value as any)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/60 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
            >
              <option value="ALL">Semua Tipe Generator (SYS & AI)</option>
              <option value="SYS">Hanya SYS (Sistem / Lokal)</option>
              <option value="AI">Hanya AI (Gemini Flash)</option>
            </select>
          </div>

          {/* Filter Kategori */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/60 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
            >
              <option value="ALL">Semua Kategori ({categoriesList.length})</option>
              {categoriesList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Filter Waktu Tayang */}
          <div>
            <select
              value={selectedPhase}
              onChange={(e) => setSelectedPhase(e.target.value as any)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/60 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
            >
              <option value="ALL">Semua Fase Tayang (5 Fase)</option>
              {AIRING_PHASES.map((p) => (
                <option key={p.id} value={p.id}>
                  Fase: {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ================= 2. STATUS & INSTRUCTION NOTE ================= */}
      <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/60 rounded-xl p-3 sm:p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
        <div className="text-xs text-purple-900 dark:text-purple-200 space-y-1">
          <p className="font-semibold">
            Pedoman Standar Waktu Tayang & Identifikasi Status Gameweek (FPL):
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-purple-800/90 dark:text-purple-300">
            <li>
              <strong>Poin & Peringkat:</strong> Jika formula menyebutkan poin atau peringkat, sistem secara mutlak melarang tayang saat fase <code className="px-1 py-0.2 bg-purple-200 dark:bg-purple-900 rounded font-bold">Not started</code>.
            </li>
            <li>
              <strong>Live vs Confirmed:</strong> Saat fase Live/Provisional, teks diperspektifkan sebagai <em>hasil sementara</em>. Saat Confirmed (Final), teks diperspektifkan sebagai <em>hasil resmi</em>.
            </li>
            <li>
              <strong>Drama Score Otomatis:</strong> Nilai dihitung via formula <code className="px-1 py-0.2 bg-purple-200 dark:bg-purple-900 rounded font-bold">Base Score + (Metrik * Bobot)</code> dan dibatasi oleh nilai Minimum & Maksimum Cap.
            </li>
          </ul>
        </div>
      </div>

      {/* ================= 3. FORMULAS CATALOG LIST ================= */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-500 dark:text-slate-400">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-purple-600 border-t-transparent mb-3" />
          <p className="text-sm font-semibold">Memuat katalog formula berita...</p>
        </div>
      ) : filteredFormulas.length === 0 ? (
        <div className="bg-white dark:bg-[#1a0b2e] rounded-xl border border-slate-200 dark:border-purple-900/60 p-8 text-center text-slate-500 dark:text-slate-400">
          <Filter className="w-8 h-8 mx-auto text-slate-400 mb-2" />
          <p className="text-sm font-bold">Tidak ada formula yang sesuai dengan filter.</p>
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setSelectedSource('ALL');
              setSelectedCategory('ALL');
              setSelectedPhase('ALL');
            }}
            className="mt-3 text-xs font-semibold text-purple-600 dark:text-[#00ff87] hover:underline cursor-pointer"
          >
            Bersihkan semua filter
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFormulas.map((formula) => {
            const isAI = formula.source === 'AI';
            const currentPreview = previewModes[formula.id] || 'live';
            const currentMetricVal = simulatorValues[formula.id] ?? formula.drama_config?.metric_default ?? 5;
            const currentDramaScore = computeClientDramaScore(formula, currentMetricVal);
            const isExpanded = Boolean(expandedCalibrations[formula.id]);
            const isSaved = savedSuccessId === formula.id;

            return (
              <div
                key={formula.id}
                className="bg-white dark:bg-[#1a0b2e] rounded-xl border border-slate-200 dark:border-purple-900/60 shadow-sm overflow-hidden transition-all hover:border-purple-300 dark:hover:border-purple-700"
              >
                {/* Formula Header Bar */}
                <div className="p-3.5 sm:p-4 bg-slate-50/70 dark:bg-[#140822] border-b border-slate-200 dark:border-purple-900/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Source Pill */}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${
                        isAI
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border-purple-300 dark:border-purple-700'
                          : 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700'
                      }`}
                    >
                      {isAI ? <Sparkles className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                      {formula.source}
                    </span>

                    {/* ID Badge */}
                    <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-[#1a0b2e] px-2 py-0.5 rounded border border-slate-200 dark:border-purple-900">
                      {formula.id}
                    </span>

                    {/* Category & Subcategory */}
                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
                      {formula.kategori}
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {formula.sub_kategori}
                    </span>

                    {/* Points / Rank Rule Indicator */}
                    {formula.mentions_points_or_rank && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900"
                        title="Menyebutkan poin/peringkat: dilarang tayang saat Not started sesuai aturan AGENTS.md"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Poin & Rank (No Not-Started)
                      </span>
                    )}
                  </div>

                  {/* Drama Score Summary Chip */}
                  <div className="flex items-center gap-2 self-start md:self-auto">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white dark:bg-[#1a0b2e] border border-slate-200 dark:border-purple-900">
                      <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        Drama:
                      </span>
                      <span className="text-xs font-extrabold text-amber-600 dark:text-amber-400">
                        {currentDramaScore}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        [{formula.drama_config.min_cap} - {formula.drama_config.max_cap}]
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveFormula(formula)}
                      disabled={isSaving}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        isSaved
                          ? 'bg-emerald-600 text-white'
                          : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm'
                      }`}
                    >
                      {isSaved ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Tersimpan!
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          Simpan
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Formula Body */}
                <div className="p-4 sm:p-5 space-y-4">
                  {/* Name & Description */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {formula.name}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      {formula.description}
                    </p>
                  </div>

                  {/* 1. Waktu Tayang (Airing Window Controls) */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-purple-900/30">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-purple-500" />
                        Izin Waktu Tayang ({formula.allowed_phases.length} Fase Aktif)
                      </label>
                      <span className="text-[11px] text-slate-400">
                        Klik fase untuk mengaktifkan/menonaktifkan
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                      {AIRING_PHASES.map((p) => {
                        const isAllowed = formula.allowed_phases.includes(p.id);
                        const isBlockedByRule = p.id === 'Not started' && formula.mentions_points_or_rank;

                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={isBlockedByRule}
                            onClick={() => handleTogglePhase(formula.id, p.id)}
                            className={`p-2 rounded-lg border text-left transition-all relative cursor-pointer ${
                              isBlockedByRule
                                ? 'opacity-40 bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                                : isAllowed
                                ? 'bg-purple-50 dark:bg-purple-950/60 border-purple-400 dark:border-purple-600 text-purple-900 dark:text-purple-100 ring-1 ring-purple-400'
                                : 'bg-slate-50 dark:bg-[#120522] border-slate-200 dark:border-purple-900/40 text-slate-500 dark:text-slate-400 opacity-60 hover:opacity-100'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold truncate">{p.label}</span>
                              {isAllowed && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 dark:text-[#00ff87] shrink-0" />
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {isBlockedByRule ? 'Dilarang (Rule FPL)' : p.desc}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Headline Variation Preview (Live vs Confirmed) */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-purple-900/30">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5 text-cyan-500" />
                        Preview Variasi Teks Berita
                      </label>

                      {/* Preview toggle pills */}
                      <div className="inline-flex rounded-lg p-0.5 bg-slate-100 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/60 text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => setPreviewModes((prev) => ({ ...prev, [formula.id]: 'live' }))}
                          className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            currentPreview === 'live'
                              ? 'bg-red-500 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          🔴 Saat Live / Sementara
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewModes((prev) => ({ ...prev, [formula.id]: 'confirmed' }))}
                          className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                            currentPreview === 'confirmed'
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          🟢 Saat Confirmed / Resmi
                        </button>
                      </div>
                    </div>

                    {/* Headline Box */}
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/40 space-y-1.5">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Bahasa Indonesia (Headline Utama):
                        </span>
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-100 mt-0.5">
                          {renderTaggedHeadline(
                            currentPreview === 'live'
                              ? formula.example_live_id
                              : formula.example_confirmed_id
                          )}
                        </div>
                      </div>

                      <div className="pt-1.5 border-t border-slate-200/60 dark:border-purple-900/30">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          English Translation:
                        </span>
                        <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 italic">
                          {renderTaggedHeadline(
                            currentPreview === 'live'
                              ? formula.example_live_en
                              : formula.example_confirmed_en
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. Drama Score Calibration & Interactive Simulator */}
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-purple-900/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          Simulator & Kalibrasi Drama Score
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCalibrations((prev) => ({
                            ...prev,
                            [formula.id]: !prev[formula.id],
                          }))
                        }
                        className="text-[11px] font-semibold text-purple-600 dark:text-[#00ff87] flex items-center gap-0.5 hover:underline cursor-pointer"
                      >
                        {isExpanded ? (
                          <>
                            Sembunyikan Pengaturan <ChevronUp className="w-3.5 h-3.5" />
                          </>
                        ) : (
                          <>
                            Ubah Parameter Rumus <ChevronDown className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>

                    {/* Interactive Slider Bar */}
                    <div className="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            Simulasi Metrik:{' '}
                          </span>
                          <span className="text-amber-800 dark:text-amber-300 font-medium">
                            {formula.drama_config.metric_label || 'Tingkat Dinamika'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-slate-600 dark:text-slate-300 text-xs">
                            Nilai: <strong>{currentMetricVal}</strong>
                          </span>
                          <span className="text-slate-400">➔</span>
                          <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-900 font-extrabold text-xs">
                            Skor Akhir: {currentDramaScore}
                          </span>
                        </div>
                      </div>

                      <input
                        type="range"
                        min={formula.drama_config.metric_min ?? 0}
                        max={formula.drama_config.metric_max ?? 30}
                        step={formula.drama_config.metric_step ?? 1}
                        value={currentMetricVal}
                        onChange={(e) =>
                          setSimulatorValues((prev) => ({
                            ...prev,
                            [formula.id]: Number(e.target.value),
                          }))
                        }
                        className="w-full mt-2 accent-amber-500 cursor-pointer"
                      />
                    </div>

                    {/* Collapsible Calibration Inputs */}
                    {isExpanded && (
                      <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-900/60 grid grid-cols-2 sm:grid-cols-4 gap-3 animate-in fade-in duration-150">
                        <div>
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                            Base Score
                          </label>
                          <input
                            type="number"
                            value={formula.drama_config.base_score}
                            onChange={(e) =>
                              handleUpdateDramaConfig(
                                formula.id,
                                'base_score',
                                Number(e.target.value)
                              )
                            }
                            className="w-full px-2.5 py-1 rounded bg-white dark:bg-[#1a0b2e] border border-slate-200 dark:border-purple-900 text-xs font-mono font-bold text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                            Bobot Metrik (Multiplier)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            value={formula.drama_config.metric_multiplier}
                            onChange={(e) =>
                              handleUpdateDramaConfig(
                                formula.id,
                                'metric_multiplier',
                                Number(e.target.value)
                              )
                            }
                            className="w-full px-2.5 py-1 rounded bg-white dark:bg-[#1a0b2e] border border-slate-200 dark:border-purple-900 text-xs font-mono font-bold text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                            Minimum Cap
                          </label>
                          <input
                            type="number"
                            value={formula.drama_config.min_cap}
                            onChange={(e) =>
                              handleUpdateDramaConfig(
                                formula.id,
                                'min_cap',
                                Number(e.target.value)
                              )
                            }
                            className="w-full px-2.5 py-1 rounded bg-white dark:bg-[#1a0b2e] border border-slate-200 dark:border-purple-900 text-xs font-mono font-bold text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                            Maksimum Cap
                          </label>
                          <input
                            type="number"
                            value={formula.drama_config.max_cap}
                            onChange={(e) =>
                              handleUpdateDramaConfig(
                                formula.id,
                                'max_cap',
                                Number(e.target.value)
                              )
                            }
                            className="w-full px-2.5 py-1 rounded bg-white dark:bg-[#1a0b2e] border border-slate-200 dark:border-purple-900 text-xs font-mono font-bold text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
