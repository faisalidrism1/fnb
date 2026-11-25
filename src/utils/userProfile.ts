import { useState, useEffect } from 'react';

/**
 * Standard opaque background classes for user selected profile row highlighting.
 * Matches exact 15%/25% emerald composite over white (Light) and #150926 (Dark)
 * with 100% opacity so sticky columns match adjacent columns seamlessly without bleed-through.
 */
export const USER_ROW_BG = 'bg-[#d9f5ec] dark:bg-[#122e35]';
export const USER_ROW_HOVER_BG = 'hover:bg-[#bfeedf] dark:hover:bg-[#10473e]';
export const USER_STICKY_CELL_BG = 'bg-[#d9f5ec] dark:bg-[#122e35] group-hover:bg-[#bfeedf] dark:group-hover:bg-[#10473e]';

export function useUserProfileId(): number | null {
  const [profileId, setProfileId] = useState<number | null>(() => {
    try {
      const val = typeof window !== 'undefined' ? localStorage.getItem('fnb_user_profile_id') : null;
      if (val && val !== 'guest' && !isNaN(Number(val))) {
        return Number(val);
      }
    } catch {}
    return null;
  });

  useEffect(() => {
    const handleSettingChanged = (e: any) => {
      if (e.detail?.key === 'user_profile_id') {
        const str = e.detail.value;
        if (str && str !== 'guest' && !isNaN(Number(str))) {
          setProfileId(Number(str));
        } else {
          setProfileId(null);
        }
      }
    };

    window.addEventListener('fnb:setting-changed', handleSettingChanged);
    return () => {
      window.removeEventListener('fnb:setting-changed', handleSettingChanged);
    };
  }, []);

  return profileId;
}
