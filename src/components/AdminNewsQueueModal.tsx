import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Shield,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Radio,
  FileText,
  Sparkles
} from 'lucide-react';
import { useLanguage } from '../utils/i18n.ts';

export interface AdminNewsItem {
  id: string;
  headline_id: string;
  headline_en: string;
  drama_score?: number;
}

interface AdminNewsQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Helper to render formatted text with highlighted tags:
 * [T:Team] -> Sky Blue (#38bdf8)
 * [P:Player] -> Neon Green (#00ff87)
 * [C:Club] -> Amber (#fbbf24)
 * [N:Stat] -> High-contrast White
 */
function FormattedHeadline({ text }: { text: string }) {
  if (!text) return null;

  // Strip title prefix (e.g. "Judul: Isi" -> "Isi")
  let clean = text.trim();
  const colonIdx = clean.indexOf(': ');
  if (colonIdx !== -1) {
    const prefix = clean.substring(0, colonIdx);
    const openBrackets = (prefix.match(/\[/g) || []).length;
    const closeBrackets = (prefix.match(/\]/g) || []).length;
    if (openBrackets === closeBrackets) {
      clean = clean.substring(colonIdx + 2).trim();
    }
  }

  // Remove exclamation marks
  clean = clean.replace(/!+/g, '.');

  if (!/\[(?:T|P|C|N):[^\]]+\]/.test(clean)) {
    return <span>{clean}</span>;
  }

  const parts = clean.split(/(\[(?:T|P|C|N):[^\]]+\])/g);
  return (
    <span>
      {parts.map((part, idx) => {
        if (!part) return null;
        const match = part.match(/^\[(T|P|C|N):([^\]]+)\]$/);
        if (match) {
          const type = match[1];
          const val = match[2];
          if (type === 'T') {
            return (
              <span key={idx} className="text-[#38bdf8] font-bold mx-0.5">
                {val}
              </span>
            );
          }
          if (type === 'P') {
            return (
              <span key={idx} className="text-[#00ff87] font-bold mx-0.5">
                {val}
              </span>
            );
          }
          if (type === 'C') {
            return (
              <span key={idx} className="text-[#fbbf24] font-semibold mx-0.5">
                {val}
              </span>
            );
          }
          if (type === 'N') {
            return (
              <span key={idx} className="text-white font-extrabold tracking-tight mx-0.5">
                {val}
              </span>
            );
          }
        }
        return <span key={idx}>{part}</span>;
      })}
    </span>
  );
}

export const AdminNewsQueueModal: React.FC<AdminNewsQueueModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { language } = useLanguage();
  const [stories, setStories] = useState<AdminNewsItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [displayLanguage, setDisplayLanguage] = useState<'id' | 'en'>(() => (language === 'en' ? 'en' : 'id'));

  // Sync initial display language with app language
  useEffect(() => {
    setDisplayLanguage(language === 'en' ? 'en' : 'id');
  }, [language]);

  // Fetch news ticker feed queue
  const fetchFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/news-ticker/feed?_t=${Date.now()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setStories(json.data);
        }
      }
    } catch (err: any) {
      console.warn('[Admin News Queue] Error fetching feed:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Trigger Gemini AI to generate fresh diverse news batch
  const handleGenerateFreshNews = async () => {
    if (isGenerating || isLoading) return;
    setIsGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/news-ticker/feed?force=1&_t=${Date.now()}`);
      if (!res.ok) {
        throw new Error(`Gagal memproduksi berita (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setStories(json.data);
        window.dispatchEvent(
          new CustomEvent('fnb:news-feed-updated', {
            detail: { data: json.data },
          })
        );
        setFeedback({
          type: 'success',
          message: `Berhasil memproduksi ${json.data.length} berita baru dari Gemini AI.`,
        });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        throw new Error(json.error || 'Respon AI tidak valid');
      }
    } catch (err: any) {
      console.error('[Admin News Queue] Generate error:', err);
      setFeedback({
        type: 'error',
        message: err.message || 'Gagal memproduksi berita baru dengan AI.',
      });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFeed();
      setFeedback(null);
    }
  }, [isOpen, fetchFeed]);

  // Handle delete story
  const handleDeleteStory = async (storyId: string) => {
    if (isDeletingId) return;
    setIsDeletingId(storyId);
    try {
      const res = await fetch('/api/news-ticker/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: storyId }),
      });

      if (!res.ok) {
        throw new Error(`Gagal menghapus berita (HTTP ${res.status})`);
      }

      const json = await res.json();
      if (json.success) {
        // Update local state immediately
        const updated = stories.filter((s) => s.id !== storyId);
        setStories(updated);

        // Broadcast to news ticker marquee component
        window.dispatchEvent(
          new CustomEvent('fnb:news-feed-updated', {
            detail: { data: updated },
          })
        );

        setFeedback({
          type: 'success',
          message: 'Berita berhasil dihapus dari antrian.',
        });
        setTimeout(() => setFeedback(null), 3000);
      } else {
        throw new Error(json.error || 'Gagal menghapus berita dari antrian');
      }
    } catch (err: any) {
      console.error('[Admin News Queue] Delete error:', err);
      setFeedback({
        type: 'error',
        message: err.message || 'Terjadi kesalahan saat menghapus berita.',
      });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setIsDeletingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[#140826] text-white rounded-2xl border border-purple-800/60 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-queue-modal-title"
      >
        {/* ================= MODAL HEADER ================= */}
        <div className="bg-gradient-to-r from-[#37003c] via-[#48004f] to-[#1e0024] p-4 sm:p-5 border-b border-purple-800/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-[#00ff87] shadow-inner shrink-0">
              <Shield className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="admin-queue-modal-title" className="text-base sm:text-lg font-black tracking-tight text-white truncate">
                  Admin Area: Antrian Berita News Ticker
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#00ff87]/20 text-[#00ff87] border border-[#00ff87]/30 shrink-0">
                  {stories.length} Antrian
                </span>
              </div>
              <p className="text-xs text-purple-200/80 font-medium truncate mt-0.5">
                Kelola siaran berita aktif pada marquee news ticker aplikasi
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-purple-200 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors shrink-0 ml-2 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ================= CONTROLS & SUBHEADER ================= */}
        <div className="px-4 sm:px-5 py-3 bg-[#1e0b38]/70 border-b border-purple-900/40 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 text-xs text-purple-200">
            <Radio className="w-3.5 h-3.5 text-[#00ff87] animate-pulse" />
            <span className="font-medium">
              Siaran Langsung News Ticker FNB League
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Generate Fresh News Button */}
            <button
              type="button"
              onClick={handleGenerateFreshNews}
              disabled={isGenerating || isLoading}
              title="Produksi batch berita baru dengan Gemini AI"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[#00ff87] text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? 'Memproduksi...' : 'Produksi Berita (AI)'}</span>
            </button>

            {/* Language preview switcher */}
            <div className="flex items-center bg-[#10061e] p-0.5 rounded-lg border border-purple-800/50">
              <button
                type="button"
                onClick={() => setDisplayLanguage('id')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  displayLanguage === 'id'
                    ? 'bg-[#37003c] text-[#00ff87] shadow-sm'
                    : 'text-purple-300 hover:text-white'
                }`}
              >
                ID (Indonesia)
              </button>
              <button
                type="button"
                onClick={() => setDisplayLanguage('en')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  displayLanguage === 'en'
                    ? 'bg-[#37003c] text-[#00ff87] shadow-sm'
                    : 'text-purple-300 hover:text-white'
                }`}
              >
                EN (English)
              </button>
            </div>

            <button
              type="button"
              onClick={fetchFeed}
              disabled={isLoading || isGenerating}
              title="Segarkan antrian"
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-purple-200 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mx-4 sm:mx-5 mt-3 p-3 rounded-xl flex items-center gap-2.5 text-xs font-semibold animate-in fade-in duration-200 ${
              feedback.type === 'success'
                ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/70 border border-rose-500/40 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* ================= STORIES QUEUE LIST ================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {isLoading && stories.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <RefreshCw className="w-8 h-8 text-[#00ff87] animate-spin mb-3" />
              <p className="text-sm font-semibold text-purple-200">Memuat antrian berita...</p>
            </div>
          ) : stories.length === 0 ? (
            <div className="py-12 px-4 rounded-xl bg-purple-950/20 border border-purple-900/40 text-center flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-2xl bg-purple-900/40 border border-purple-700/50 flex items-center justify-center text-purple-300 mb-3">
                <FileText className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-white mb-1">
                Tidak ada berita dalam antrian
              </p>
              <p className="text-xs text-purple-300/80 max-w-sm mb-4">
                Seluruh berita pada antrian telah dihapus atau belum ada berita yang diproduksi.
              </p>
              <button
                type="button"
                onClick={fetchFeed}
                className="px-3.5 py-1.5 rounded-lg bg-[#37003c] hover:bg-[#4d0054] text-[#00ff87] border border-[#00ff87]/40 text-xs font-bold transition-all cursor-pointer"
              >
                Muat Ulang Antrian
              </button>
            </div>
          ) : (
            stories.map((story, idx) => {
              const headlineText =
                displayLanguage === 'en'
                  ? story.headline_en || story.headline_id
                  : story.headline_id || story.headline_en;

              const isDeleting = isDeletingId === story.id;

              return (
                <div
                  key={story.id}
                  className={`group relative flex items-start justify-between gap-3 p-3.5 sm:p-4 rounded-xl border transition-all ${
                    isDeleting
                      ? 'bg-rose-950/30 border-rose-800/40 opacity-50'
                      : 'bg-[#1b0a33] hover:bg-[#220d40] border-purple-900/50 hover:border-purple-700/60 shadow-sm'
                  }`}
                >
                  {/* Left content: Index & Formatted text */}
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className="w-6 h-6 rounded-lg bg-[#37003c] border border-purple-700/50 text-[#00ff87] font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                      #{idx + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-[13px] leading-relaxed text-slate-200">
                        <FormattedHeadline text={headlineText} />
                      </div>

                      {/* Alternate language preview subtext */}
                      <div className="mt-1.5 text-[11px] text-purple-400/80 font-medium italic line-clamp-2">
                        {displayLanguage === 'id' ? story.headline_en : story.headline_id}
                      </div>

                      {story.drama_score && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-purple-950/80 border border-purple-800/60 text-[10px] font-bold text-purple-300">
                            Drama Score: {story.drama_score}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Distinct 'x' Delete Button */}
                  <button
                    type="button"
                    onClick={() => handleDeleteStory(story.id)}
                    disabled={isDeleting}
                    title="Hapus berita dari antrian"
                    aria-label={`Hapus berita nomor ${idx + 1}`}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-400 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 transition-all cursor-pointer shrink-0 disabled:opacity-50 active:scale-95"
                  >
                    {isDeleting ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-red-400" />
                    ) : (
                      <X className="w-4 h-4 stroke-[2.5]" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* ================= MODAL FOOTER ================= */}
        <div className="bg-[#10061e] px-4 sm:px-5 py-3 border-t border-purple-900/50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-purple-400/80 font-medium">
            Tanda <strong className="text-red-400 font-bold">x</strong> di sebelah kanan akan langsung menghapus berita dari siaran ticker.
          </span>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-700/50 text-white font-bold text-xs sm:text-sm transition-all cursor-pointer"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
