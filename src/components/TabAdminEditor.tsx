import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Save,
  Undo2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Filter,
  Tag,
  Database,
  ChevronDown,
  AlertTriangle,
  Info,
  Copy,
} from 'lucide-react';

export interface Phase1TemplateItem {
  no: number;
  id: string;
  gw_phase: string;
  category: string;
  subcategory: string;
  title?: string;
  output?: 'SINGLE-NEWS' | 'MULTI-NEWS' | string;
  source?: 'Bukan' | 'Sys' | string;
  template: string;
  example: string;
  code: string;
  sample_data?: Record<string, string | number>;
  updated_at?: string;
}

export interface TagValidationResult {
  isValid: boolean;
  warnings: string[];
}

/**
 * Validates syntax of tags [T:...], [P:...], [C:...], [N:...], [Kondisi:...], and {placeholders}
 */
export function validateTemplateTags(template: string, sampleData?: Record<string, any>): TagValidationResult {
  const warnings: string[] = [];
  if (!template || !template.trim()) {
    return { isValid: false, warnings: ['Template teks narasi tidak boleh kosong'] };
  }

  // 1. Check bracket balance [ and ]
  let bracketDepth = 0;
  let inBracket = false;
  let bracketStart = -1;

  for (let i = 0; i < template.length; i++) {
    const char = template[i];
    if (char === '[') {
      if (inBracket) {
        warnings.push(`Kurung siku bersarang terdeteksi`);
      }
      inBracket = true;
      bracketDepth++;
      bracketStart = i;
    } else if (char === ']') {
      if (!inBracket) {
        warnings.push(`Tanda ']' penutup tanpa tanda pembuka '['`);
      }
      inBracket = false;
      bracketDepth--;
    }
  }
  if (bracketDepth > 0) {
    const unclosedChunk = template.slice(bracketStart, Math.min(bracketStart + 20, template.length));
    warnings.push(`Kurung siku belum tertutup: "${unclosedChunk}..."`);
  }

  // 2. Check brace balance { and }
  let braceDepth = 0;
  let inBrace = false;
  let braceStart = -1;

  for (let i = 0; i < template.length; i++) {
    const char = template[i];
    if (char === '{') {
      if (inBrace) {
        warnings.push(`Kurung kurawal ganda terdeteksi`);
      }
      inBrace = true;
      braceDepth++;
      braceStart = i;
    } else if (char === '}') {
      if (!inBrace) {
        warnings.push(`Tanda '}' penutup tanpa tanda pembuka '{'`);
      }
      inBrace = false;
      braceDepth--;
    }
  }
  if (braceDepth > 0) {
    const unclosedBrace = template.slice(braceStart, Math.min(braceStart + 16, template.length));
    warnings.push(`Placeholder belum tertutup: "${unclosedBrace}..."`);
  }

  // 3. Check tag prefixes inside [ ... ]
  const tagMatches = template.matchAll(/\[([^\]]+)\]/g);
  for (const m of tagMatches) {
    const tagContent = m[1].trim();
    if (tagContent.toLowerCase().startsWith('kondisi:')) continue;
    const colonIndex = tagContent.indexOf(':');
    if (colonIndex > 0) {
      const prefix = tagContent.slice(0, colonIndex);
      if (!['T', 'P', 'C', 'N'].includes(prefix)) {
        warnings.push(`Prefix '[${prefix}:]' tidak standar (gunakan T, P, C, atau N)`);
      }
    }
  }

  // 4. Check unrecognized placeholders against sampleData keys if available
  if (sampleData) {
    const placeholderMatches = template.matchAll(/\{([a-zA-Z0-9_]+)\}/g);
    const knownKeys = new Set(Object.keys(sampleData));
    for (const pm of placeholderMatches) {
      const varName = pm[1];
      if (!knownKeys.has(varName)) {
        warnings.push(`Parameter {${varName}} belum ada di sample_data`);
      }
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

/**
 * Replaces placeholders {key} with sampleData[key] dynamically as user edits template.
 * If template contains multiple [Kondisi: ...], renders each condition cleanly with its header!
 */
function computeDynamicExample(template: string, sampleData?: Record<string, any>): string {
  if (!template) return '';
  if (!sampleData) return template;

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

function splitConditionSections(text: string): Array<{ header: string; condName: string; body: string }> {
  const sections: Array<{ header: string; condName: string; body: string }> = [];
  const lines = String(text || '').split('\n');
  let currentHeader = '';
  let currentCondName = '';
  let currentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(line);
    if (match) {
      if (currentHeader || currentLines.length > 0) {
        sections.push({
          header: currentHeader,
          condName: currentCondName,
          body: currentLines.join('\n').trim(),
        });
      }
      currentHeader = match[0];
      currentCondName = match[1].trim();
      currentLines = [];
    } else if (line) {
      currentLines.push(rawLine);
    }
  }

  if (currentHeader || currentLines.length > 0) {
    sections.push({
      header: currentHeader,
      condName: currentCondName,
      body: currentLines.join('\n').trim(),
    });
  }

  return sections;
}

function buildBranchRegex(body: string): { rx: RegExp; staticLen: number } {
  const parts = body.trim().split(/(\{[a-zA-Z0-9_]+\})/g);
  let staticLen = 0;
  const pattern = parts
    .map((part) => {
      if (/^\{[a-zA-Z0-9_]+\}$/.test(part)) return '[\\s\\S]*?';
      staticLen += part.replace(/\s+/g, '').length;
      return part.replace(/[.*+?^$|()[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    })
    .join('');
  return { rx: new RegExp('^' + pattern + '$', 'i'), staticLen };
}

function buildRealExampleForRow(
  row: Phase1TemplateItem,
  realStories: Array<{ id: string; headline_id: string }>
): string {
  const rowIdLower = row.id.toLowerCase();
  const matchingStories = realStories.filter((s) => {
    const sid = s.id.toLowerCase();
    return sid === rowIdLower || sid.startsWith(`${rowIdLower}_`);
  });

  if (matchingStories.length === 0) {
    return row.example;
  }

  const hasConditions = /\[Kondisi:[^\]]+\]/i.test(row.template);
  if (!hasConditions) {
    return matchingStories[0].headline_id || row.example;
  }

  const templateBranches = splitConditionSections(row.template).filter((s) => s.header);
  const sampleText = /\[Kondisi:[^\]]+\]/i.test(row.example || '')
    ? row.example
    : computeDynamicExample(row.template, row.sample_data);
  const sampleBranches = splitConditionSections(sampleText);

  const branches = templateBranches.map((tb, idx) => {
    const { rx, staticLen } = buildBranchRegex(tb.body);
    const matchingSample =
      sampleBranches.find((sb) => sb.condName.toLowerCase() === tb.condName.toLowerCase()) ||
      sampleBranches[idx];
    return {
      header: tb.header,
      rx,
      staticLen,
      sampleBody: matchingSample?.body || computeDynamicExample(tb.body, row.sample_data),
      realHeadline: '',
    };
  });

  for (const story of matchingStories) {
    const headline = String(story.headline_id || '').trim();
    if (!headline) continue;
    const matched = branches.filter((b) => b.rx.test(headline));
    if (matched.length > 0) {
      matched.sort((a, b) => b.staticLen - a.staticLen);
      if (!matched[0].realHeadline) {
        matched[0].realHeadline = headline;
      }
    }
  }

  return branches
    .map((b) => `${b.header}\n${b.realHeadline || b.sampleBody}`)
    .join('\n\n')
    .trim();
}

/**
 * Renders formatted example headline with identical entity badge styling to TabAdmin News Ticker table
 * ([T:Team], [P:Player], [C:Club], [N:Number]) and clean [Kondisi: ...] section headers.
 */
function renderFormattedExample(text: string): React.ReactNode {
  if (!text) return null;

  const renderLineWithTags = (line: string, lineKey: string) => {
    const parts: React.ReactNode[] = [];
    const regex = /\[([TPCN]):([^\]]+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }

      const tagType = match[1];
      const tagContent = match[2];
      const key = `${lineKey}-${match.index}-${tagType}-${tagContent}`;

      switch (tagType) {
        case 'T':
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded font-extrabold text-[12px] leading-tight bg-purple-100 dark:bg-purple-950/80 text-[#37003c] dark:text-[#00ff87] border border-purple-200 dark:border-purple-800/60"
            >
              {tagContent}
            </span>
          );
          break;
        case 'P':
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded font-bold text-[12px] leading-tight bg-cyan-100 dark:bg-cyan-950/80 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60"
            >
              {tagContent}
            </span>
          );
          break;
        case 'C':
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded font-semibold text-[12px] leading-tight bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
            >
              {tagContent}
            </span>
          );
          break;
        case 'N':
          parts.push(
            <span
              key={key}
              className="inline-flex items-center px-1 rounded font-black text-[12px] leading-tight bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60"
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

    if (lastIndex < line.length) {
      parts.push(line.substring(lastIndex));
    }

    return parts;
  };

  const lines = text.split('\n');
  return lines.map((rawLine, idx) => {
    const trimmed = rawLine.trim();
    const condMatch = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(trimmed);
    if (condMatch) {
      return (
        <div
          key={`cond-${idx}`}
          className="text-[12px] font-black uppercase tracking-wider text-purple-700 dark:text-[#00ff87] mt-1.5 first:mt-0 mb-0.5 leading-relaxed"
        >
          Kondisi: {condMatch[1].trim()}
        </div>
      );
    }
    if (!trimmed) {
      return <div key={`sp-${idx}`} className="h-1" />;
    }
    return (
      <div key={`line-${idx}`} className="text-[12px] leading-relaxed">
        {renderLineWithTags(rawLine, `l${idx}`)}
      </div>
    );
  });
}

const PHASE_ORDER = [
  'Not started',
  'Live Match',
  'Between Match',
  'Provisional',
  'Confirmed',
] as const;

const FLOATING_TAG_OPTIONS = [
  { value: '[T:Nama Tim]', label: '[T:Tim]', desc: 'Entitas Tim FPL' },
  { value: '[P:Nama Pemain]', label: '[P:Pemain]', desc: 'Entitas Pemain' },
  { value: '[C:Nama Klub]', label: '[C:Klub]', desc: 'Klub Premier League' },
  { value: '[N:Angka]', label: '[N:Angka]', desc: 'Angka, Skor, GW, Poin' },
  { value: '[Kondisi: 1 Tim]\n', label: '[Kondisi]', desc: 'Header Cabang Kondisi' },
];

export const TabAdminEditor: React.FC = () => {
  // Last saved data state
  const [savedRows, setSavedRows] = useState<Phase1TemplateItem[]>([]);
  // Currently edited data state
  const [editableRows, setEditableRows] = useState<Phase1TemplateItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mutually bound Filters: Phase, Category, Subcategory
  const [selectedPhase, setSelectedPhase] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('ALL');

  // Preview Mode Toggle: Sample Data vs Real League Data
  const [previewMode, setPreviewMode] = useState<'sample' | 'real'>('sample');
  const [realStoriesList, setRealStoriesList] = useState<Array<{ id: string; headline_id: string }>>([]);
  const [isLoadingRealPreview, setIsLoadingRealPreview] = useState<boolean>(false);

  // Floating Tag Dropdown State
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState<boolean>(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // Textarea reference for top-level single Tag Inserter
  const activeTextareaRef = useRef<{ index: number; el: HTMLTextAreaElement } | null>(null);

  // Close tag dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target as Node)) {
        setIsTagDropdownOpen(false);
      }
    }
    if (isTagDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isTagDropdownOpen]);

  // Fetch templates from API with auto-retries & cache busting
  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const maxRetries = 2;
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const res = await fetch(`/api/admin/phase1-templates?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const json = await res.json();
        if (json && Array.isArray(json.data)) {
          setSavedRows(json.data);
          setEditableRows(JSON.parse(JSON.stringify(json.data)));
          setError(null);
          setIsLoading(false);
          return;
        } else {
          throw new Error('Format data tidak valid');
        }
      } catch (err: any) {
        attempt++;
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 600));
        } else {
          console.error('[TabAdminEditor] Fetch error:', err);
          setError(err?.message || 'Gagal memuat template formula');
          setIsLoading(false);
        }
      }
    }
    setIsLoading(false);
  }, []);

  // Fetch real league stories for Real Data Preview mode with auto-retries & cache busting
  const fetchRealPreviewStories = useCallback(async () => {
    setIsLoadingRealPreview(true);
    const maxRetries = 2;
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const res = await fetch(`/api/admin/phase1-templates/real-preview?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const json = await res.json();
        if (json && Array.isArray(json.data)) {
          const list = json.data
            .filter((story: any) => story && story.id && story.headline_id)
            .map((story: any) => ({
              id: String(story.id),
              headline_id: String(story.headline_id),
            }));
          setRealStoriesList(list);
          setIsLoadingRealPreview(false);
          return;
        }
      } catch (err: any) {
        attempt++;
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 600));
        } else {
          console.warn('[TabAdminEditor] Real preview fetch error:', err.message);
          setIsLoadingRealPreview(false);
        }
      }
    }
    setIsLoadingRealPreview(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (previewMode === 'real' && realStoriesList.length === 0) {
      fetchRealPreviewStories();
    }
  }, [previewMode, realStoriesList.length, fetchRealPreviewStories]);

  // Check if any edits have occurred compared to saved state
  const hasChanges = useMemo(() => {
    if (savedRows.length === 0 || editableRows.length === 0) return false;
    return JSON.stringify(savedRows) !== JSON.stringify(editableRows);
  }, [savedRows, editableRows]);

  // Toast notification
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Template cell change handler
  const handleTemplateChange = (index: number, newTemplateValue: string) => {
    setEditableRows((prev) => {
      const next = [...prev];
      const target = next[index];
      if (!target) return prev;
      const recomputedExample = computeDynamicExample(newTemplateValue, target.sample_data);

      next[index] = {
        ...target,
        template: newTemplateValue,
        example: recomputedExample,
      };
      return next;
    });
  };

  // Metadata cell change handler
  const handleMetaChange = (
    index: number,
    field: 'gw_phase' | 'category' | 'subcategory' | 'title' | 'output',
    val: string
  ) => {
    setEditableRows((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      const updated = {
        ...next[index],
        [field]: val,
      };
      if (field === 'gw_phase' && val.trim().toLowerCase() === 'live match' && !updated.output) {
        updated.output = 'MULTI-NEWS';
      }
      next[index] = updated;
      return next;
    });
  };

  // Top Floating Tag Inserter: Inserts tag into the active template textarea
  const handleTopInsertTag = (tagString: string) => {
    let targetIndex = activeTextareaRef.current?.index;
    if (targetIndex === undefined || targetIndex < 0 || targetIndex >= editableRows.length) {
      targetIndex = 0;
    }

    const currentRow = editableRows[targetIndex];
    if (!currentRow) return;

    let newTemplate = currentRow.template || '';
    let targetCursorPos = newTemplate.length;

    if (activeTextareaRef.current && activeTextareaRef.current.index === targetIndex) {
      const el = activeTextareaRef.current.el;
      const start = el.selectionStart ?? newTemplate.length;
      const end = el.selectionEnd ?? newTemplate.length;
      newTemplate = newTemplate.substring(0, start) + tagString + newTemplate.substring(end);
      targetCursorPos = start + tagString.length;

      handleTemplateChange(targetIndex, newTemplate);

      setTimeout(() => {
        el.focus();
        el.setSelectionRange(targetCursorPos, targetCursorPos);
      }, 10);
    } else {
      newTemplate = newTemplate ? `${newTemplate} ${tagString}` : tagString;
      handleTemplateChange(targetIndex, newTemplate);
      showToast(`Disisipkan ke Baris #${targetIndex + 1} (${currentRow.title || currentRow.subcategory || currentRow.id})`);
    }
  };

  // Save all table contents to server
  const handleSaveAll = async () => {
    setIsSaving(true);
    setSaveError(null);
    setIsConfirmingCancel(false);
    try {
      const res = await fetch('/api/admin/phase1-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(editableRows),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `HTTP error ${res.status}`);
      }
      if (json && json.success) {
        const persistedRows = Array.isArray(json.data) ? json.data : editableRows;
        setSavedRows(JSON.parse(JSON.stringify(persistedRows)));
        setEditableRows(JSON.parse(JSON.stringify(persistedRows)));
        // Clear cached real preview stories so switching to Data Riil always fetches fresh data
        setRealStoriesList([]);
        if (previewMode === 'real') {
          fetchRealPreviewStories();
        }
        // Notify NewsTicker and TabAdminNewsTable immediately
        window.dispatchEvent(
          new CustomEvent('fnb:news-ticker-updated', { detail: { timestamp: Date.now() } })
        );
        showToast('Seluruh template berhasil disimpan dan langsung diterapkan!');
      } else {
        throw new Error(json?.error || 'Gagal menyimpan');
      }
    } catch (err: any) {
      console.error('[TabAdminEditor] Save error:', err);
      setSaveError('Gagal menyimpan perubahan: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  // Cancel edits and revert (inline two-step confirmation instead of window.confirm)
  const handleCancelAll = () => {
    if (hasChanges && !isConfirmingCancel) {
      setIsConfirmingCancel(true);
      setTimeout(() => {
        setIsConfirmingCancel(false);
      }, 4000);
      return;
    }
    setIsConfirmingCancel(false);
    setSaveError(null);
    setEditableRows(JSON.parse(JSON.stringify(savedRows)));
    showToast('Perubahan dibatalkan dan dikembalikan ke kondisi simpanan terakhir.');
  };

  // Mutually bound Phases list (constrained by active Category & Subcategory)
  const phasesList = useMemo(() => {
    const set = new Set<string>();
    editableRows.forEach((r) => {
      const phase = r.gw_phase || 'Not started';
      if (selectedCategory !== 'ALL' && r.category !== selectedCategory) return;
      if (selectedSubcategory !== 'ALL' && r.subcategory !== selectedSubcategory) return;
      if (phase) set.add(phase);
    });
    return Array.from(set).sort((a, b) => {
      const idxA = PHASE_ORDER.findIndex((p) => p.toLowerCase() === a.toLowerCase());
      const idxB = PHASE_ORDER.findIndex((p) => p.toLowerCase() === b.toLowerCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [editableRows, selectedCategory, selectedSubcategory]);

  // Mutually bound Categories list (constrained by active Phase & Subcategory)
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    editableRows.forEach((r) => {
      const phase = r.gw_phase || 'Not started';
      if (selectedPhase !== 'ALL' && phase.toLowerCase() !== selectedPhase.toLowerCase()) return;
      if (selectedSubcategory !== 'ALL' && r.subcategory !== selectedSubcategory) return;
      if (r.category) set.add(r.category);
    });
    return Array.from(set).sort();
  }, [editableRows, selectedPhase, selectedSubcategory]);

  // Mutually bound Subcategories list (constrained by active Phase & Category)
  const subcategoriesList = useMemo(() => {
    const set = new Set<string>();
    editableRows.forEach((r) => {
      const phase = r.gw_phase || 'Not started';
      if (selectedPhase !== 'ALL' && phase.toLowerCase() !== selectedPhase.toLowerCase()) return;
      if (selectedCategory !== 'ALL' && r.category !== selectedCategory) return;
      if (r.subcategory) set.add(r.subcategory);
    });
    return Array.from(set).sort();
  }, [editableRows, selectedPhase, selectedCategory]);

  // Handlers for mutually bound Phase, Category, Subcategory dropdowns
  const handlePhaseFilterChange = (newPhase: string) => {
    setSelectedPhase(newPhase);
    let nextCategory = selectedCategory;
    if (newPhase !== 'ALL' && selectedCategory !== 'ALL') {
      const catValid = editableRows.some(
        (r) =>
          (r.gw_phase || 'Not started').toLowerCase() === newPhase.toLowerCase() &&
          r.category === selectedCategory
      );
      if (!catValid) {
        nextCategory = 'ALL';
        setSelectedCategory('ALL');
      }
    }
    if (selectedSubcategory !== 'ALL') {
      const subValid = editableRows.some(
        (r) =>
          (newPhase === 'ALL' ||
            (r.gw_phase || 'Not started').toLowerCase() === newPhase.toLowerCase()) &&
          (nextCategory === 'ALL' || r.category === nextCategory) &&
          r.subcategory === selectedSubcategory
      );
      if (!subValid) {
        setSelectedSubcategory('ALL');
      }
    }
  };

  const handleCategoryFilterChange = (newCategory: string) => {
    setSelectedCategory(newCategory);
    if (selectedSubcategory !== 'ALL') {
      const subValid = editableRows.some(
        (r) =>
          (selectedPhase === 'ALL' ||
            (r.gw_phase || 'Not started').toLowerCase() === selectedPhase.toLowerCase()) &&
          (newCategory === 'ALL' || r.category === newCategory) &&
          r.subcategory === selectedSubcategory
      );
      if (!subValid) {
        setSelectedSubcategory('ALL');
      }
    }
  };

  const handleSubcategoryFilterChange = (newSubcategory: string) => {
    setSelectedSubcategory(newSubcategory);
  };

  // Filtered rows by mutually bound Phase, Category, and Subcategory
  const filteredRows = useMemo(() => {
    return editableRows.filter((r) => {
      const phase = r.gw_phase || 'Not started';
      if (selectedPhase !== 'ALL' && phase.toLowerCase() !== selectedPhase.toLowerCase()) {
        return false;
      }
      if (selectedCategory !== 'ALL' && r.category !== selectedCategory) {
        return false;
      }
      if (selectedSubcategory !== 'ALL' && r.subcategory !== selectedSubcategory) {
        return false;
      }
      return true;
    });
  }, [editableRows, selectedPhase, selectedCategory, selectedSubcategory]);

  return (
    <div className="space-y-3 pb-8">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#37003c] text-white px-4 py-2.5 rounded-xl shadow-2xl border border-[#00ff87] flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-4 h-4 text-[#00ff87]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Save Error Banner */}
      {saveError && (
        <div className="bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-3 text-xs font-bold">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{saveError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-rose-700 dark:text-rose-300 hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Clean Top Header Toolbar */}
      <div className="bg-white dark:bg-[#190a2a] rounded-xl border border-slate-200 dark:border-purple-900/60 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Left: Mutually Bound Phase, Category, Subcategory Dropdown Filters */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 text-xs w-full lg:w-auto">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 hidden sm:inline-flex items-center gap-1 mr-0.5">
            <Filter className="w-3.5 h-3.5 text-purple-600 dark:text-[#00ff87]" />
          </span>

          {/* Phase Filter */}
          <select
            value={selectedPhase}
            onChange={(e) => handlePhaseFilterChange(e.target.value)}
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
            onChange={(e) => handleCategoryFilterChange(e.target.value)}
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
            onChange={(e) => handleSubcategoryFilterChange(e.target.value)}
            className="w-full sm:w-auto px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-[#10051e] border border-slate-300 dark:border-purple-900/60 font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Subcategories</option>
            {subcategoriesList.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>

          {/* Reset Filters button */}
          {(selectedPhase !== 'ALL' || selectedCategory !== 'ALL' || selectedSubcategory !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSelectedPhase('ALL');
                setSelectedCategory('ALL');
                setSelectedSubcategory('ALL');
              }}
              className="text-[#37003c] dark:text-[#00ff87] font-bold hover:underline cursor-pointer whitespace-nowrap px-1 text-left sm:text-center"
            >
              Reset
            </button>
          )}
        </div>

        {/* Center / Right Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* FLOATING DROPDOWN TAG INSERTER (Matches Tab Style) */}
          <div className="relative inline-block text-left" ref={tagDropdownRef}>
            <button
              type="button"
              onClick={() => setIsTagDropdownOpen((prev) => !prev)}
              className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-2.5 shadow-2xs flex items-center justify-between gap-1.5 cursor-pointer focus:outline-none transition-colors"
            >
              <Tag className="w-3.5 h-3.5 text-purple-600 dark:text-[#00ff87]" />
              <span>Sisip Tag</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 transition-transform duration-150 ${
                  isTagDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isTagDropdownOpen && (
              <>
                {/* Floating Dropdown Card with Shadow */}
                <div className="absolute right-0 mt-1.5 min-w-[210px] bg-white dark:bg-[#190a2a] border border-slate-200 dark:border-purple-800/80 text-slate-800 dark:text-slate-100 shadow-2xl rounded-xl z-50 p-1.5 animate-in fade-in zoom-in-95 space-y-0.5">
                  <div className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-purple-400/80 border-b border-slate-100 dark:border-purple-900/40 mb-1">
                    Pilih Tag untuk Disisipkan
                  </div>
                  {FLOATING_TAG_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        handleTopInsertTag(opt.value);
                        setIsTagDropdownOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer gap-2 hover:bg-purple-50 dark:hover:bg-purple-900/40 text-slate-700 dark:text-slate-200 hover:text-purple-900 dark:hover:text-[#00ff87]"
                    >
                      <span className="font-mono font-bold text-[11px] text-purple-900 dark:text-[#00ff87]">
                        {opt.label}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-400">
                        {opt.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Clean Preview Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#10051e] p-1 rounded-lg border border-slate-200 dark:border-purple-900/60">
            <button
              type="button"
              onClick={() => setPreviewMode('sample')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                previewMode === 'sample'
                  ? 'bg-white dark:bg-[#250d3d] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Data Sampel
            </button>

            <button
              type="button"
              onClick={() => setPreviewMode('real')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                previewMode === 'real'
                  ? 'bg-white dark:bg-[#250d3d] text-emerald-700 dark:text-[#00ff87] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Database className="w-3 h-3 text-[#00ff87]" />
              <span>Data Riil</span>
              {isLoadingRealPreview && <RefreshCw className="w-3 h-3 animate-spin text-[#00ff87]" />}
            </button>
          </div>

          {/* Unsaved changes indicator */}
          {hasChanges && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 whitespace-nowrap">
              Belum disimpan
            </span>
          )}

          {/* Action Buttons: Cancel & Save */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancelAll}
              disabled={!hasChanges || isSaving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                isConfirmingCancel && hasChanges && !isSaving
                  ? 'bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 cursor-pointer shadow-xs active:scale-95'
                  : hasChanges && !isSaving
                  ? 'bg-slate-100 hover:bg-slate-200 dark:bg-purple-950/70 dark:hover:bg-purple-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-purple-800/80 cursor-pointer shadow-xs active:scale-95'
                  : 'bg-slate-100 dark:bg-[#120522] text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-purple-950 cursor-not-allowed opacity-60'
              }`}
              title="Kembalikan seluruh konten tabel ke kondisi terakhir kali di-save"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>{isConfirmingCancel ? 'Yakin Batal?' : 'Cancel'}</span>
            </button>

            <button
              type="button"
              onClick={handleSaveAll}
              disabled={!hasChanges || isSaving}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-black transition-all ${
                hasChanges && !isSaving
                  ? 'bg-[#00ff87] hover:bg-[#00e57a] text-[#37003c] shadow-xs hover:shadow-md cursor-pointer active:scale-95'
                  : 'bg-[#00ff87]/40 text-[#37003c]/50 cursor-not-allowed'
              }`}
              title="Menyimpan keseluruhan konten tabel dan menerapkan langsung ke aplikasi"
            >
              <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
              <span>{isSaving ? 'Menyimpan...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Table: Fixed Column Widths Fitted to Exact Mobile & Word Specs */}
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
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-slate-500 dark:text-slate-400">
            <Info className="w-6 h-6 mx-auto text-slate-400" />
            <p className="text-xs font-bold">
              Tidak ada template formula yang sesuai dengan kombinasi filter yang dipilih.
            </p>
            {(selectedPhase !== 'ALL' || selectedCategory !== 'ALL' || selectedSubcategory !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSelectedPhase('ALL');
                  setSelectedCategory('ALL');
                  setSelectedSubcategory('ALL');
                }}
                className="text-xs font-bold text-[#37003c] dark:text-[#00ff87] hover:underline cursor-pointer"
              >
                Reset Filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="table-fixed text-left border-collapse text-xs w-full min-w-[1840px]">
              <thead>
                <tr className="bg-slate-100 dark:bg-[#10051e] border-b-2 border-slate-200 dark:border-purple-900/80 text-slate-800 dark:text-slate-200 uppercase tracking-wider font-black text-[11px]">
                  {/* 1. ID: Identifier (~140px) */}
                  <th className="py-3 px-2.5 w-[140px] min-w-[140px] max-w-[140px] border-r border-slate-200 dark:border-purple-900/50">
                    ID
                  </th>
                  {/* 2. GW Phase: Fitted to 1 longest word (~110px) */}
                  <th className="py-3 px-2.5 w-[110px] min-w-[110px] max-w-[110px] border-r border-slate-200 dark:border-purple-900/50 break-words">
                    GW Phase
                  </th>
                  {/* 3. Categories: Fitted to 1 longest word (~120px) */}
                  <th className="py-3 px-2.5 w-[120px] min-w-[120px] max-w-[120px] border-r border-slate-200 dark:border-purple-900/50 break-words">
                    Categories
                  </th>
                  {/* 4. Sub Categories: Fitted to 1 longest word (~130px) */}
                  <th className="py-3 px-2.5 w-[130px] min-w-[130px] max-w-[130px] border-r border-slate-200 dark:border-purple-900/50 break-words">
                    Sub Categories
                  </th>
                  {/* 5. Title: Editable Story Title (~140px) */}
                  <th className="py-3 px-2.5 w-[140px] min-w-[140px] max-w-[140px] border-r border-slate-200 dark:border-purple-900/50 break-words">
                    Title
                  </th>
                  {/* 6. Output: Dedicated Column (~120px) */}
                  <th className="py-3 px-2.5 w-[120px] min-w-[120px] max-w-[120px] border-r border-slate-200 dark:border-purple-900/50 break-words">
                    Output
                  </th>
                  {/* 6. Template: Fitted exactly to 1 Mobile View (~360px) */}
                  <th className="py-3 px-3 w-[360px] min-w-[360px] max-w-[360px] border-r border-slate-200 dark:border-purple-900/50 whitespace-nowrap">
                    Template <span className="text-[#00ff87] font-bold lowercase text-[10px] ml-1">(editable)</span>
                  </th>
                  {/* 7. Example: Fitted exactly to 1 Mobile View (~360px) */}
                  <th className="py-3 px-3 w-[360px] min-w-[360px] max-w-[360px] border-r border-slate-200 dark:border-purple-900/50 whitespace-nowrap">
                    Example <span className="text-slate-400 font-medium lowercase text-[10px] ml-1">({previewMode === 'real' ? 'real' : 'sample'})</span>
                  </th>
                  {/* 8. Code: Fitted exactly to 1 Mobile View (~360px) */}
                  <th className="py-3 px-3 w-[360px] min-w-[360px] max-w-[360px] whitespace-nowrap">
                    Code <span className="text-slate-400 font-medium lowercase text-[10px] ml-1">(clean logic)</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-purple-900/40">
                {filteredRows.map((row) => {
                  const originalIndex = editableRows.findIndex((r) => r.id === row.id);
                  const actualIndex = originalIndex >= 0 ? originalIndex : 0;
                  const validation = validateTemplateTags(row.template, row.sample_data);

                  const displayExample = previewMode === 'real'
                    ? buildRealExampleForRow(row, realStoriesList)
                    : row.example;

                  // Output logic: Live Match is strictly MULTI-NEWS
                  const isLiveMatch = (row.gw_phase || '').trim().toLowerCase() === 'live match';
                  const resolvedOutput = isLiveMatch
                    ? 'MULTI-NEWS'
                    : (row.output || (row.id === 'NS_PLAYER_AVAILABILITY_FLAGGED' || row.title === 'Flagged Players' || row.subcategory === 'Flagged Players' ? 'MULTI-NEWS' : 'SINGLE-NEWS'));

                  return (
                    <tr
                      key={`${row.no}_${row.id}_${actualIndex}`}
                      className="hover:bg-purple-50/20 dark:hover:bg-purple-950/20 transition-colors align-top"
                    >
                      {/* 1. ID (Identifier with Copy, aligned top matching GW phase first line, wrapping without table overlap) */}
                      <td className="py-2.5 px-2.5 border-r border-slate-200 dark:border-purple-900/30 w-[140px] min-w-[140px] max-w-[140px] align-top overflow-hidden">
                        <div className="w-full py-2 px-1.5 border border-transparent flex items-start justify-between gap-1 box-border">
                          <span
                            className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-200 select-all leading-snug break-all [overflow-wrap:anywhere]"
                            title={row.id}
                          >
                            {row.id}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(row.id);
                              showToast(`ID ${row.id} disalin!`);
                            }}
                            className="text-slate-400 hover:text-purple-600 dark:hover:text-[#00ff87] p-0.5 cursor-pointer shrink-0 rounded transition-colors -mr-0.5"
                            title="Salin ID Template"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* 2. GW Phase (Fitted to 1 Longest Word) */}
                      <td className="py-2.5 px-2 border-r border-slate-200 dark:border-purple-900/30 w-[110px] max-w-[110px] align-top">
                        <textarea
                          value={row.gw_phase}
                          onChange={(e) => handleMetaChange(actualIndex, 'gw_phase', e.target.value)}
                          className="w-full h-[96px] min-h-[96px] max-h-[96px] px-1.5 py-2 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-[11px] font-bold text-slate-800 dark:text-slate-100 outline-none transition-all resize-none leading-snug break-words overflow-y-auto scrollbar-thin"
                          placeholder="GW Phase"
                        />
                      </td>

                      {/* 3. Categories (Fitted to 1 Longest Word) */}
                      <td className="py-2.5 px-2 border-r border-slate-200 dark:border-purple-900/30 w-[120px] max-w-[120px] align-top">
                        <textarea
                          value={row.category}
                          onChange={(e) => handleMetaChange(actualIndex, 'category', e.target.value)}
                          className="w-full h-[96px] min-h-[96px] max-h-[96px] px-1.5 py-2 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-[11px] font-bold text-purple-900 dark:text-[#00ff87] outline-none transition-all resize-none leading-snug break-words overflow-y-auto scrollbar-thin"
                          placeholder="Category"
                        />
                      </td>

                      {/* 4. Sub Categories */}
                      <td className="py-2.5 px-2 border-r border-slate-200 dark:border-purple-900/30 w-[130px] max-w-[130px] align-top">
                        <textarea
                          value={row.subcategory}
                          onChange={(e) => handleMetaChange(actualIndex, 'subcategory', e.target.value)}
                          className="w-full h-[96px] min-h-[96px] max-h-[96px] px-1.5 py-2 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-[11px] font-bold text-slate-900 dark:text-white outline-none transition-all resize-none leading-snug break-words overflow-y-auto scrollbar-thin"
                          placeholder="Sub Category"
                        />
                      </td>

                      {/* 5. Title (Editable) */}
                      <td className="py-2.5 px-2 border-r border-slate-200 dark:border-purple-900/30 w-[140px] max-w-[140px] align-top">
                        <textarea
                          value={row.title ?? ''}
                          onChange={(e) => handleMetaChange(actualIndex, 'title', e.target.value)}
                          className="w-full h-[96px] min-h-[96px] max-h-[96px] px-1.5 py-2 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-[11px] font-bold text-slate-800 dark:text-slate-100 outline-none transition-all resize-none leading-snug break-words overflow-y-auto scrollbar-thin"
                          placeholder="Title"
                        />
                      </td>

                      {/* 6. Output (Editable text matching GW Phase / Categories / Sub Categories) */}
                      <td className="py-2.5 px-2 border-r border-slate-200 dark:border-purple-900/30 w-[120px] min-w-[120px] max-w-[120px] align-top">
                        <textarea
                          value={row.output ?? resolvedOutput}
                          onChange={(e) => handleMetaChange(actualIndex, 'output', e.target.value)}
                          title={
                            /multi/i.test(resolvedOutput)
                              ? 'Multiple: Menghasilkan beberapa baris berita sesuai peristiwa/pemain'
                              : 'Single: Menghasilkan tepat 1 baris berita per Gameweek'
                          }
                          className={`w-full h-[96px] min-h-[96px] max-h-[96px] px-1.5 py-2 rounded-md bg-transparent hover:bg-slate-100 dark:hover:bg-[#120522] focus:bg-white dark:focus:bg-[#10051e] border border-transparent focus:border-[#00ff87] text-[11px] font-bold outline-none transition-all resize-none leading-snug break-words overflow-y-auto scrollbar-thin ${
                            /multi/i.test(resolvedOutput)
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                          placeholder="Output"
                        />
                      </td>

                      {/* 4. Template (Fixed 4-line height with vertical scroll) */}
                      <td className="py-2.5 px-3 border-r border-slate-200 dark:border-purple-900/30 w-[360px] max-w-[360px] relative">
                        <textarea
                          ref={(el) => {
                            if (el && activeTextareaRef.current?.index === actualIndex) {
                              activeTextareaRef.current = { index: actualIndex, el };
                            }
                          }}
                          onFocus={(e) => {
                            activeTextareaRef.current = { index: actualIndex, el: e.target };
                          }}
                          value={row.template}
                          onChange={(e) => handleTemplateChange(actualIndex, e.target.value)}
                          className={`editor-uniform-text w-full h-[96px] min-h-[96px] max-h-[96px] p-2.5 rounded-md bg-white/70 dark:bg-[#10051e]/80 hover:bg-white dark:hover:bg-[#10051e] focus:bg-white dark:focus:bg-[#10051e] border text-[12px] font-medium text-slate-900 dark:text-white outline-none transition-all resize-none overflow-y-auto scrollbar-thin leading-relaxed font-sans shadow-2xs ${
                            validation.isValid
                              ? 'border-purple-200 dark:border-purple-900/60 focus:border-[#00ff87]'
                              : 'border-rose-400 dark:border-rose-800/80 focus:border-rose-500'
                          }`}
                          placeholder="Template teks narasi..."
                        />

                        {/* Subtle warning icon if syntax is invalid */}
                        {!validation.isValid && (
                          <div
                            className="absolute bottom-4 right-5 text-rose-500 dark:text-rose-400 cursor-help"
                            title={validation.warnings.join(' • ')}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                          </div>
                        )}
                      </td>

                      {/* 5. Example (Fixed 4-line height with vertical scroll like template) */}
                      <td className="py-2.5 px-3 border-r border-slate-200 dark:border-purple-900/30 w-[360px] max-w-[360px]">
                        <div className="editor-uniform-text w-full h-[96px] min-h-[96px] max-h-[96px] p-2.5 rounded-md bg-slate-50 dark:bg-[#120522] border border-slate-200 dark:border-purple-950 text-[12px] font-medium text-slate-800 dark:text-slate-200 leading-relaxed font-sans overflow-y-auto scrollbar-thin select-text whitespace-pre-wrap break-words">
                          {renderFormattedExample(displayExample)}
                        </div>
                      </td>

                      {/* 6. Code (Fixed 4-line height with vertical scroll like template) */}
                      <td className="py-2.5 px-3 w-[360px] max-w-[360px]">
                        <pre className="w-full h-[96px] min-h-[96px] max-h-[96px] p-2.5 rounded-md bg-slate-100/90 dark:bg-[#0c0316] border border-slate-200 dark:border-purple-900/40 text-[11px] font-mono text-emerald-800 dark:text-emerald-300 leading-snug whitespace-pre overflow-y-auto overflow-x-auto select-text scrollbar-thin">
                          {row.code}
                        </pre>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
