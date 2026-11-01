import { useState, useEffect } from 'react';

/**
 * Standard background tint classes for user selected profile row highlighting.
 * STRICT: Only background color is altered (zero layout shift, zero extra elements).
 */
export const USER_ROW_BG = 'bg-emerald-500/15 dark:bg-[#00ff87]/15';
export const USER_ROW_HOVER_BG = 'hover:bg-emerald-500/25 dark:hover:bg-[#00ff87]/25';

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
