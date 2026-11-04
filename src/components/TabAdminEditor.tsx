import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Save,
  Undo2,
  RefreshCw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

export interface Phase1TemplateItem {
  no: number;
  id: string;
  gw_phase: string;
  category: string;
  subcategory: string;
  template: string;
  example: string;
  code: string;
  sample_data?: Record<string, string | number>;
  updated_at?: string;
}

/**
 * Replaces placeholders {key} with sampleData[key] dynamically as user edits template.
 * If template contains multiple [Kondisi: ...], renders each condition cleanly with its header!
 */
function computeDynamicExample(template: string, sampleData?: Record<string, any>): string {
  if (!template) return '';
  if (!sampleData) return template;

  // Check if template contains conditions [Kondisi: ...]
  const conditionHeaderRegex = /\[Kondisi:\s*([^\]]+)\]/gi;
  const hasConditions = /\[Kondisi:[^\]]+\]/i.test(template);

  if (hasConditions) {
    const lines = template.split('\n');
    let currentCondition = '';
    const renderedSections: { header: string; lines: string[] }[] = [];
    let currentLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(line);
      if (match) {
        if (currentCondition || currentLines.length > 0) {
          renderedSections.push({ header: currentCondition, lines: currentLines });
        }
        currentCondition = match[0];
        currentLines = [];
      } else if (line) {
        currentLines.push(rawLine);
      }
    }

    if (currentCondition || currentLines.length > 0) {
      renderedSections.push({ header: currentCondition, lines: currentLines });
    }

    return renderedSections.map((sec) => {
      let body = sec.lines.join('\n');
      for (const [k, v] of Object.entries(sampleData)) {
        const regex = new RegExp(`\\{${k}\\}`, 'g');
        body = body.replace(regex, String(v));
      }
      return sec.header ? `${sec.header}\n${body}` : body;
    }).join('\n\n').trim();
  }

  // Single template condition
  let result = template;
  for (const [k, v] of Object.entries(sampleData)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

export const TabAdminEditor: React.FC = () => {
  // Last saved data state
  const [savedRows, setSavedRows] = useState<Phase1TemplateItem[]>([]);
  // Currently edited data state (Template column editable, Example automatically updates)
  const [editableRows, setEditableRows] = useState<Phase1TemplateItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Fetch templates from API
  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/phase1-templates', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      if (json && Array.isArray(json.data)) {
        setSavedRows(json.data);
        setEditableRows(JSON.parse(JSON.stringify(json.data)));
      } else {
        throw new Error('Format data tidak valid');
      }
    } catch (err: any) {
      console.error('[TabAdminEditor] Fetch error:', err);
      setError(err?.message || 'Gagal memuat template formula');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Check if any edits have occurred compared to saved state
  const hasChanges = useMemo(() => {
    if (savedRows.length === 0 || editableRows.length === 0) return false;
    return JSON.stringify(savedRows) !== JSON.stringify(editableRows);
  }, [savedRows, editableRows]);

  // Show toast notification
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Template cell change handler: simultaneously updates template and dynamically recomputes Example
  const handleTemplateChange = (index: number, newTemplateValue: string) => {
    setEditableRows((prev) => {
      const next = [...prev];
      const target = next[index];
      const recomputedExample = computeDynamicExample(newTemplateValue, target.sample_data);

      next[index] = {
        ...target,
        template: newTemplateValue,
        example: recomputedExample,
      };
      return next;
    });
  };

  // Other metadata cell change handler (GW Phase, Category, Subcategory)
  const handleMetaChange = (index: number, field: 'gw_phase' | 'category' | 'subcategory', val: string) => {
    setEditableRows((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: val,
      };
      return next;
    });
  };

  // Save all table contents to server
  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/phase1-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(editableRows),
      });

      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      if (json && json.success) {
        setSavedRows(JSON.parse(JSON.stringify(editableRows)));
        showToast('Seluruh template berhasil disimpan dan langsung diterapkan ke aplikasi!');
      } else {
        throw new Error(json?.error || 'Gagal menyimpan');
      }
    } catch (err: any) {
      console.error('[TabAdminEditor] Save error:', err);
      alert('Gagal menyimpan perubahan: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  // Cancel edits and revert to last saved state
  const handleCancelAll = () => {
    if (hasChanges) {
      const confirmRevert = window.confirm(
        'Kembalikan seluruh konten tabel ke kondisi terakhir kali di-save?'
      );
      if (!confirmRevert) return;
    }
    setEditableRows(JSON.parse(JSON.stringify(savedRows)));
    showToast('Seluruh perubahan berhasil dibatalkan dan dikembalikan ke kondisi save terakhir.');
  };

  return (
    <div className="space-y-3 pb-8">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#37003c] text-white px-4 py-3 rounded-xl shadow-2xl border-2 border-[#00ff87] flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-4 h-4 text-[#00ff87]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Bar with Exactly 2 Main Execution Buttons */}
      <div className="bg-white dark:bg-[#190a2a] rounded-xl border border-slate-200 dark:border-purple-900/60 p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
            Editor Formula Berita FNB League
          </h2>
          {hasChanges && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              Ada perubahan belum disimpan
            </span>
          )}
        </div>

        {/* 2 Execution Buttons */}
        <div className="flex items-center gap-2.5">
          {/* Cancel Button */}
          <button
            type="button"
            onClick={handleCancelAll}
            disabled={!hasChanges || isSaving}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              hasChanges && !isSaving
                ? 'bg-slate-100 hover:bg-slate-200 dark:bg-purple-950/70 dark:hover:bg-purple-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-purple-800/80 cursor-pointer shadow-xs active:scale-95'
                : 'bg-slate-100 dark:bg-[#120522] text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-purple-950 cursor-not-allowed opacity-60'
            }`}
            title="Kembalikan seluruh konten tabel ke kondisi terakhir kali di-save"
          >
            <Undo2 className="w-4 h-4" />
            <span>Cancel</span>
          </button>

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={!hasChanges || isSaving}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-black transition-all ${
              hasChanges && !isSaving
                ? 'bg-[#00ff87] hover:bg-[#00e57a] text-[#37003c] shadow-md hover:shadow-lg cursor-pointer active:scale-95'
                : 'bg-[#00ff87]/40 text-[#37003c]/50 cursor-not-allowed'
            }`}
            title="Menyimpan keseluruhan konten tabel dan menerapkan langsung ke aplikasi"
          >
            <Save className={`w-4 h-4 ${isSaving ? 'animate-spin' : ''}`} />
            <span>{isSaving ? 'Menyimpan...' : 'Save'}</span>
          </button>
        </div>
      </div>

      {/* Main Clean Table: 6 Exact Requested Columns, Wide & Low-Wrap */}
      <div className="bg-white dark:bg-[#190a2a] rounded-xl border border-slate-200 dark:border-purple-900/60 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center space-y-2">
            <RefreshCw className="w-6 h-6 mx-auto text-[#00ff87] animate-spin" />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Memuat data tabel formula...
            </p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-2">
            <AlertCircle className="w-6 h-6 mx-auto text-rose-500" />
            <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{error}</p>
            <button
              type="button"
              onClick={fetchTemplates}
              className="px-3 py-1.5 rounded-lg bg-[#37003c] text-white text-xs font-bold cursor-pointer"
            >
              Coba Lagi
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="text-left border-collapse text-xs w-full min-w-[2200px]">
              <thead>
                <tr className="bg-slate-100 dark:bg-[#10051e] border-b-2 border-slate-200 dark:border-purple-900/80 text-slate-800 dark:text-slate-200 uppercase tracking-wider font-black text-[11px]">
                  {/* 1. GW Phase (Wide, no wrap) */}
                  <th className="py-3 px-4 w-[160px] border-r border-slate-200 dark:border-purple-900/50 whitespace-nowrap">
                    GW Phase
                  </th>
                  {/* 2. Categories (Wide, no wrap) */}
                  <th className="py-3 px-4 w-[180px] border-r border-slate-200 dark:border-purple-900/50 whitespace-nowrap">
                    Categories
                  </th>
                  {/* 3. Sub Categories (Wide, no wrap) */}
                  <th className="py-3 px-4 w-[240px] border-r border-slate-200 dark:border-purple-900/50 whitespace-nowrap">
                    Sub Categories
                  </th>
                  {/* 4. Template (Directly Editable - Changing this automatically updates Example) */}
                  <th className="py-3 px-4 w-[520px] border-r border-slate-200 dark:border-purple-900/50 whitespace-nowrap">
                    Template <span className="text-[#00ff87] font-bold lowercase text-[10px] ml-1">(editable)</span>
                  </th>
                  {/* 5. Example (Read-only, dynamically follows Template) */}
                  <th className="py-3 px-4 w-[500px] border-r border-slate-200 dark:border-purple-900/50 whitespace-nowrap">
                    Example <span className="text-slate-400 font-medium lowercase text-[10px] ml-1">(auto-follow)</span>
                  </th>
                  {/* 6. Code (Read-only, clean logic without hardcoded narrative) */}
                  <th className="py-3 px-4 w-[600px] whitespace-nowrap">
                    Code <span className="text-slate-400 font-medium lowercase text-[10px] ml-1">(clean logic)</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-purple-900/40">
                {editableRows.map((row, index) => (
                  <tr
                    key={row.id || index}
                    className="hover:bg-purple-50/20 dark:hover:bg-purple-950/20 transition-colors align-top"
                  >
                    {/* 1. GW Phase (Editable) */}
                    <td className="py-2.5 px-3 border-r border-slate-200 dark:border-purple-900/30">
                      <input
                        type="text"
                        value={row.gw_phase}
                        onChange={(e) => handleMetaChange(index, 'gw_phase', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-xs font-bold text-slate-800 dark:text-slate-100 outline-none transition-all whitespace-nowrap"
                        placeholder="GW Phase"
                      />
                    </td>

                    {/* 2. Categories (Editable) */}
                    <td className="py-2.5 px-3 border-r border-slate-200 dark:border-purple-900/30">
                      <input
                        type="text"
                        value={row.category}
                        onChange={(e) => handleMetaChange(index, 'category', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-xs font-bold text-purple-900 dark:text-[#00ff87] outline-none transition-all whitespace-nowrap"
                        placeholder="Category"
                      />
                    </td>

                    {/* 3. Sub Categories (Editable) */}
                    <td className="py-2.5 px-3 border-r border-slate-200 dark:border-purple-900/30">
                      <input
                        type="text"
                        value={row.subcategory}
                        onChange={(e) => handleMetaChange(index, 'subcategory', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-xs font-bold text-slate-900 dark:text-white outline-none transition-all whitespace-nowrap"
                        placeholder="Sub Category"
                      />
                    </td>

                    {/* 4. Template (Directly Editable Textarea - Edit here updates Example live) */}
                    <td className="py-2.5 px-3 border-r border-slate-200 dark:border-purple-900/30">
                      <textarea
                        value={row.template}
                        onChange={(e) => handleTemplateChange(index, e.target.value)}
                        rows={row.template.includes('[Kondisi:') ? 5 : 3}
                        className="w-full p-2.5 rounded-md bg-white/70 dark:bg-[#10051e]/80 hover:bg-white dark:hover:bg-[#10051e] focus:bg-white dark:focus:bg-[#10051e] border border-purple-200 dark:border-purple-900/60 focus:border-[#00ff87] text-xs font-medium text-slate-900 dark:text-white outline-none transition-all resize-y leading-relaxed font-sans shadow-2xs"
                        placeholder="Template teks narasi..."
                      />
                    </td>

                    {/* 5. Example (Read-only, Automatically Updates Following Template, Preserves Line Breaks) */}
                    <td className="py-2.5 px-3 border-r border-slate-200 dark:border-purple-900/30">
                      <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-950 text-xs font-medium text-slate-800 dark:text-slate-200 leading-relaxed font-sans min-h-[60px] select-text whitespace-pre-wrap">
                        {row.example}
                      </div>
                    </td>

                    {/* 6. Code (Read-only, Clean Production Logic without Hardcoded Narrative) */}
                    <td className="py-2.5 px-3">
                      <pre className="p-2.5 rounded-md bg-slate-100/90 dark:bg-[#0c0316] border border-slate-200 dark:border-purple-900/40 text-[11px] font-mono text-emerald-800 dark:text-emerald-300 leading-snug whitespace-pre overflow-x-auto select-text max-h-[160px] scrollbar-thin">
                        {row.code}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
