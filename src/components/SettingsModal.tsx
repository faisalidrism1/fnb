import React, { useState, useMemo, useEffect } from 'react';
import {
  Settings,
  X,
  User,
  Sun,
  Radio,
  Globe,
  Shield,
  ChevronRight,
  Check,
  ChevronDown,
  Sparkles,
  Info,
  AlertCircle
} from 'lucide-react';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import { StandingsRow, TransferItem } from '../types.ts';
import { isWakeLockSupported, requestWakeLock, releaseWakeLock } from '../utils/wakeLock.ts';
import { useLanguage, Language } from '../utils/i18n.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  standings?: Record<number, StandingsRow[]>;
  transfers?: TransferItem[];
  currentProfileEntryId?: number | null;
  onSelectProfile?: (entryId: number) => void;
}

export interface FnbTeamProfile {
  id: number;
  entryName: string;
  playerName: string;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  standings = {},
  transfers = [],
  currentProfileEntryId,
  onSelectProfile,
}) => {
  // Extract all unique teams and managers from FNB League data
  const fnbTeams = useMemo(() => {
    const map = new Map<number, FnbTeamProfile>();

    // 1. First priority: standings (contains all enrolled league members)
    if (standings && typeof standings === 'object') {
      const gwKeys = Object.keys(standings).sort((a, b) => Number(b) - Number(a));
      for (const gw of gwKeys) {
        const rows = standings[Number(gw)];
        if (Array.isArray(rows)) {
          rows.forEach((row) => {
            if (row && row.entry_id && row.entry_name && !map.has(row.entry_id)) {
              map.set(row.entry_id, {
                id: row.entry_id,
                entryName: row.entry_name.trim(),
                playerName: (row.player_name || '').trim(),
              });
            }
          });
        }
      }
    }

    // 2. Extra fallback: all_transfers
    if (Array.isArray(transfers)) {
      transfers.forEach((t) => {
        if (t && t.entry_id && t.entry_name && !map.has(t.entry_id)) {
          map.set(t.entry_id, {
            id: t.entry_id,
            entryName: t.entry_name.trim(),
            playerName: (t.player_name || '').trim(),
          });
        }
      });
    }

    // Sort alphabetically by Team Name (entryName)
    return Array.from(map.values()).sort((a, b) =>
      a.entryName.localeCompare(b.entryName, undefined, { sensitivity: 'base' })
    );
  }, [standings, transfers]);

  // Profile selection state (persisted locally)
  const [selectedEntryId, setSelectedEntryId] = useState<string>(() => {
    if (currentProfileEntryId) return String(currentProfileEntryId);
    try {
      const saved = localStorage.getItem('fnb_user_profile_id');
      if (saved) return saved;
    } catch {}
    return '';
  });

  // Keep Screen Awake state
  const [keepScreenAwake, setKeepScreenAwake] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fnb_setting_keep_awake') === 'true';
    } catch {
      return false;
    }
  });

  // News Ticker state (default OFF when not yet determined by user)
  const [newsTicker, setNewsTicker] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fnb_setting_news_ticker') === 'true';
    } catch {
      return false;
    }
  });

  // Language state & translation hook
  const { language, setLanguage, t } = useLanguage();

  // Admin Area notification state
  const [adminNotice, setAdminNotice] = useState<string | null>(null);

  // Sync state if prop changes
  useEffect(() => {
    if (currentProfileEntryId) {
      setSelectedEntryId(String(currentProfileEntryId));
    }
  }, [currentProfileEntryId]);

  // Handle profile selection
  const handleProfileChange = (val: string | number) => {
    const strVal = String(val);
    setSelectedEntryId(strVal);
    try {
      localStorage.setItem('fnb_user_profile_id', strVal);
    } catch {}
    if (onSelectProfile && strVal) {
      onSelectProfile(Number(strVal));
    }
  };

  const isSupported = useMemo(() => isWakeLockSupported(), []);

  // Handle toggles
  const handleToggleKeepAwake = async () => {
    const next = !keepScreenAwake;
    setKeepScreenAwake(next);
    try {
      localStorage.setItem('fnb_setting_keep_awake', String(next));
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('fnb:setting-changed', {
            detail: { key: 'keep_awake', value: next },
          })
        );
      }, 0);
    } catch {}

    if (next) {
      await requestWakeLock();
    } else {
      await releaseWakeLock();
    }
  };

  const handleToggleNewsTicker = () => {
    const next = !newsTicker;
    setNewsTicker(next);
    try {
      localStorage.setItem('fnb_setting_news_ticker', String(next));
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('fnb:setting-changed', {
            detail: { key: 'news_ticker', value: next },
          })
        );
      }, 0);
    } catch {}
  };

  const handleSelectLanguage = (lang: Language) => {
    setLanguage(lang);
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Selected profile details
  const currentProfile = fnbTeams.find((t) => String(t.id) === selectedEntryId);

  // Dropdown options: Strictly without "All Teams"
  const popoverOptions = fnbTeams.map((t) => ({
    value: String(t.id),
    label: t.entryName,
    sublabel: t.playerName,
  }));

  const profileBadge = t('settings_profile_badge', { N: fnbTeams.length });
  const profileDesc = t('settings_profile_desc');
  const adminDesc = t('settings_admin_desc');
  const adminNoticeText = t('settings_admin_notice');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white dark:bg-[#150a24] rounded-2xl max-w-lg w-full border border-slate-200 dark:border-purple-900/60 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150">
        {/* ================= MODAL HEADER ================= */}
        <div className="bg-gradient-to-r from-[#37003c] via-[#28002d] to-[#1c0022] text-white px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-[#00ff87] shadow-inner">
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight leading-none text-white">
                {t('modal_settings_title')}
              </h2>
              <p className="text-[11px] sm:text-xs text-purple-200/80 font-medium mt-0.5">
                {t('modal_settings_subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 text-purple-200 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            title={t('tooltip_close_settings')}
            aria-label={t('tooltip_close_settings')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ================= MODAL BODY ================= */}
        <div className="p-4 sm:p-5 space-y-4 sm:space-y-5 overflow-y-auto overflow-x-hidden text-slate-800 dark:text-slate-100 divide-y divide-slate-100 dark:divide-purple-900/40">
          
          {/* ================= 1. PROFILE SECTION ================= */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-purple-100 dark:bg-purple-950/80 text-[#37003c] dark:text-[#00ff87] flex items-center justify-center">
                  <User className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
                <label
                  htmlFor="settings-profile-select"
                  className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white"
                >
                  {t('settings_profile_label')}
                </label>
              </div>

              {profileBadge && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-[#00ff87] border border-emerald-200 dark:border-emerald-800/40">
                  {profileBadge}
                </span>
              )}
            </div>

            {profileDesc && (
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-snug">
                {profileDesc}
              </p>
            )}

            {/* Dropdown nama tim dan manager FNB League tanpa 'All Teams' */}
            <div className="w-full">
              <CustomPopoverSelect
                id="settings-profile-select"
                value={selectedEntryId}
                onChange={handleProfileChange}
                options={popoverOptions}
                placeholder={t('settings_profile_placeholder')}
                className="w-full bg-slate-50 dark:bg-purple-950/40 border border-slate-300 dark:border-purple-800/70 hover:border-[#37003c] dark:hover:border-[#00ff87] rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 py-2.5 px-3 shadow-2xs flex items-center justify-between gap-2 cursor-pointer focus:outline-none transition-all"
                dropdownClassName="w-full min-w-[280px] sm:min-w-[340px] max-h-72"
                searchable={true}
                customTrigger={({ isOpen, value }) => {
                  const selected = fnbTeams.find((t) => String(t.id) === String(value));
                  return (
                    <div className="flex items-center justify-between w-full min-w-0">
                      <div className="flex flex-col text-left truncate mr-2 min-w-0">
                        {selected ? (
                          <>
                            <span className="font-bold text-slate-900 dark:text-white text-xs truncate">
                              {selected.entryName}
                            </span>
                            <span className="text-[10.5px] font-medium text-slate-500 dark:text-purple-300/80 truncate">
                              {selected.playerName} • ID: {selected.id}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 text-xs italic">
                            {t('settings_profile_placeholder')}
                          </span>
                        )}
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                          isOpen ? 'rotate-180 text-purple-600 dark:text-[#00ff87]' : ''
                        }`}
                      />
                    </div>
                  );
                }}
              />
            </div>

            {currentProfile && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/50 border border-purple-200/80 dark:border-purple-800/40 text-[11px] text-purple-900 dark:text-purple-200">
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-[#00ff87] shrink-0" />
                <span className="truncate">
                  {language === 'en' ? 'Active profile: ' : 'Profil aktif: '}
                  <strong className="font-bold">{currentProfile.entryName}</strong> ({currentProfile.playerName})
                </span>
              </div>
            )}
          </div>

          {/* ================= 2. TOGGLES: KEEP SCREEN AWAKE & NEWS TICKER ================= */}
          <div className="pt-4 space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('settings_display_heading')}
            </span>

            {/* Toggle 1: Keep Screen Awake */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-purple-950/30 border border-slate-200/80 dark:border-purple-900/40 hover:border-slate-300 dark:hover:border-purple-800/60 transition-colors space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Sun className="w-4 h-4 stroke-[2.2]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white leading-tight">
                        {t('settings_keep_awake_title')}
                      </span>
                      <span
                        className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded font-mono ${
                          keepScreenAwake
                            ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-[#00ff87]'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {keepScreenAwake ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                      {t('settings_keep_awake_desc')}
                    </p>
                  </div>
                </div>

                {/* iOS style toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={keepScreenAwake}
                  onClick={handleToggleKeepAwake}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    keepScreenAwake
                      ? 'bg-[#00ff87]'
                      : 'bg-slate-300 dark:bg-purple-950/80'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow-md ring-0 transition duration-200 ease-in-out ${
                      keepScreenAwake
                        ? 'translate-x-5 bg-[#37003c]'
                        : 'translate-x-0 bg-white'
                    }`}
                  />
                </button>
              </div>

              {keepScreenAwake && isSupported && (
                <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-200/60 dark:border-purple-900/40 text-[10.5px] text-emerald-600 dark:text-[#00ff87] font-medium animate-in fade-in duration-150">
                  <Check className="w-3.5 h-3.5 shrink-0 stroke-[2.5]" />
                  <span>{t('settings_keep_awake_active')}</span>
                </div>
              )}

              {!isSupported && (
                <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-200/60 dark:border-purple-900/40 text-[10.5px] text-amber-600 dark:text-amber-400 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('settings_keep_awake_unsupported')}</span>
                </div>
              )}
            </div>

            {/* Toggle 2: News Ticker */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-purple-950/30 border border-slate-200/80 dark:border-purple-900/40 hover:border-slate-300 dark:hover:border-purple-800/60 transition-colors">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 dark:text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Radio className="w-4 h-4 stroke-[2.2]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white leading-tight">
                      {t('settings_news_ticker_title')}
                    </span>
                    <span
                      className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded font-mono ${
                        newsTicker
                          ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-[#00ff87]'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {newsTicker ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    {t('settings_news_ticker_desc')}
                  </p>
                </div>
              </div>

              {/* iOS style toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={newsTicker}
                onClick={handleToggleNewsTicker}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  newsTicker
                    ? 'bg-[#00ff87]'
                    : 'bg-slate-300 dark:bg-purple-950/80'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow-md ring-0 transition duration-200 ease-in-out ${
                    newsTicker
                      ? 'translate-x-5 bg-[#37003c]'
                      : 'translate-x-0 bg-white'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* ================= 3. LANGUAGE SECTION (FNB DEFAULT, ENGLISH, INDONESIA) ================= */}
          <div className="pt-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Globe className="w-3.5 h-3.5 stroke-[2.5]" />
              </div>
              <span className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white">
                {t('settings_language_heading')}
              </span>
            </div>

            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-snug">
              {t('settings_language_desc')}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              {/* Option 1: FNB Default */}
              <button
                type="button"
                onClick={() => handleSelectLanguage('fnb')}
                className={`relative flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                  language === 'fnb'
                    ? 'bg-purple-50/70 dark:bg-purple-900/40 border-[#37003c] dark:border-[#00ff87] shadow-xs ring-1 ring-[#37003c] dark:ring-[#00ff87]'
                    : 'bg-slate-50 dark:bg-purple-950/20 border-slate-200 dark:border-purple-900/40 hover:border-slate-300 dark:hover:border-purple-800'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-[#37003c] text-[#00ff87] flex items-center justify-center font-black text-xs shrink-0 shadow-xs">
                  ⚡
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-[12.5px] font-bold text-slate-900 dark:text-white truncate">
                      FNB Default
                    </span>
                    {language === 'fnb' && (
                      <span className="w-3.5 h-3.5 rounded-full bg-[#00ff87] text-[#37003c] flex items-center justify-center shrink-0 ml-1">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-purple-300/80 block mt-0.5 truncate">
                    Tampilan Bawaan FNB
                  </span>
                </div>
              </button>

              {/* Option 2: English */}
              <button
                type="button"
                onClick={() => handleSelectLanguage('en')}
                className={`relative flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                  language === 'en'
                    ? 'bg-purple-50/70 dark:bg-purple-900/40 border-[#37003c] dark:border-[#00ff87] shadow-xs ring-1 ring-[#37003c] dark:ring-[#00ff87]'
                    : 'bg-slate-50 dark:bg-purple-950/20 border-slate-200 dark:border-purple-900/40 hover:border-slate-300 dark:hover:border-purple-800'
                }`}
              >
                <span className="text-2xl leading-none shrink-0" role="img" aria-label="United Kingdom Flag">
                  🇬🇧
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-[12.5px] font-bold text-slate-900 dark:text-white truncate">
                      English
                    </span>
                    {language === 'en' && (
                      <span className="w-3.5 h-3.5 rounded-full bg-[#00ff87] text-[#37003c] flex items-center justify-center shrink-0 ml-1">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-purple-300/80 block mt-0.5 truncate">
                    English (UK)
                  </span>
                </div>
              </button>

              {/* Option 3: Indonesian */}
              <button
                type="button"
                onClick={() => handleSelectLanguage('id')}
                className={`relative flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                  language === 'id'
                    ? 'bg-purple-50/70 dark:bg-purple-900/40 border-[#37003c] dark:border-[#00ff87] shadow-xs ring-1 ring-[#37003c] dark:ring-[#00ff87]'
                    : 'bg-slate-50 dark:bg-purple-950/20 border-slate-200 dark:border-purple-900/40 hover:border-slate-300 dark:hover:border-purple-800'
                }`}
              >
                <span className="text-2xl leading-none shrink-0" role="img" aria-label="Indonesia Flag">
                  🇮🇩
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-[12.5px] font-bold text-slate-900 dark:text-white truncate">
                      Indonesia
                    </span>
                    {language === 'id' && (
                      <span className="w-3.5 h-3.5 rounded-full bg-[#00ff87] text-[#37003c] flex items-center justify-center shrink-0 ml-1">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-purple-300/80 block mt-0.5 truncate">
                    Bahasa Indonesia
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* ================= 4. TOMBOL ADMIN AREA ================= */}
          <div className="pt-4 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('settings_admin_heading')}
            </span>

            <button
              type="button"
              onClick={() => {
                if (adminNoticeText) {
                  setAdminNotice(adminNoticeText);
                  setTimeout(() => setAdminNotice(null), 4000);
                }
              }}
              className="w-full flex items-center justify-between p-3 sm:p-3.5 rounded-xl bg-gradient-to-r from-[#37003c] via-[#48004f] to-[#1e0024] hover:from-[#490050] hover:via-[#5c0065] hover:to-[#2c0035] text-white border border-purple-500/40 hover:border-[#00ff87]/60 shadow-md hover:shadow-lg transition-all cursor-pointer group active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-[#00ff87] group-hover:scale-105 transition-transform shadow-inner">
                  <Shield className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.2]" />
                </div>
                <div className="text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-black tracking-tight text-white">
                      {t('settings_admin_title')}
                    </span>
                    <span className="text-[9.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                      {t('settings_admin_badge')}
                    </span>
                  </div>
                  {adminDesc && (
                    <p className="text-[10.5px] sm:text-[11px] text-purple-200/80 font-medium truncate mt-0.5">
                      {adminDesc}
                    </p>
                  )}
                </div>
              </div>

              <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-purple-200 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0 ml-2">
                <ChevronRight className="w-4 h-4" />
              </div>
            </button>

            {adminNotice && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 text-xs animate-in fade-in duration-150">
                <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>{adminNotice}</span>
              </div>
            )}
          </div>
        </div>

        {/* ================= MODAL FOOTER ================= */}
        <div className="bg-slate-50 dark:bg-[#10061e] px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-purple-900/50 flex items-center justify-between shrink-0">
          <span className="text-[10.5px] sm:text-[11px] text-slate-400 dark:text-slate-500 font-medium">
            {t('settings_footer_brand')}
          </span>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#37003c] hover:bg-[#48004f] text-white text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
          >
            {t('btn_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
