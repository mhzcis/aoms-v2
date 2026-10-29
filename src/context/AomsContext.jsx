import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SupabaseRepository } from '../repositories/supabaseRepository';
import { AomsService } from '../services/aomsService';

const C = createContext(null);
export const useAoms = () => useContext(C);

export function AomsProvider({ children, customRepo = null, initialProfile = null }) {
  const repo = useMemo(
    () => customRepo || (supabase ? new SupabaseRepository(supabase) : null),
    [customRepo]
  );
  const service = useMemo(() => (repo ? new AomsService(repo) : null), [repo]);
  const [session, setSession] = useState(initialProfile ? { user: initialProfile } : null);
  const [profile, setProfile] = useState(initialProfile);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(!!repo && !initialProfile);
  const [dataReady, setDataReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  // Depend on the signed-in user id, not on the session object: supabase-js hands out a new
  // session object on every getSession()/auth event, which previously re-created `refresh`,
  // re-ran the effects below and produced an endless reload + resubscribe loop.
  const userId = session ? session.user?.id || 'session' : null;
  const refresh = useCallback(async () => {
    if (!service || (!userId && !initialProfile)) return;
    try {
      const next = await service.load();
      setData(next);
      setDataReady(true);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setDataReady(true);
    }
  }, [service, userId, initialProfile]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!repo || customRepo) {
      if (customRepo) refreshRef.current();
      return;
    }
    repo
      .session()
      .then(setSession)
      .finally(() => setLoading(false));
    if (supabase?.auth) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
      return () => subscription.unsubscribe();
    }
  }, [repo, customRepo]);

  useEffect(() => {
    if (!repo || !userId) return;
    if (customRepo) {
      refresh();
      if (typeof repo.subscribe === 'function') {
        const unsub = repo.subscribe(() => refresh());
        return () => (typeof unsub === 'function' ? unsub() : repo.unsubscribe?.(unsub));
      }
      return;
    }
    repo
      .profile(userId)
      .then(p => {
        if (p.status !== 'active') {
          repo.signOut();
          setProfile(null);
          setSession(null);
          setError('تم تعطيل هذا الحساب من قبل الإدارة');
        } else {
          setProfile(p);
        }
      })
      .catch(e => setError(e.message));
    refresh();
    const ch = repo.subscribe(() => refresh());
    return () => repo.unsubscribe(ch);
  }, [repo, userId, customRepo, refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const f = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) refresh();
    };
    window.addEventListener('online', f);
    window.addEventListener('offline', f);
    return () => {
      window.removeEventListener('online', f);
      window.removeEventListener('offline', f);
    };
  }, [refresh]);

  const runAction = async (fn, successMsg) => {
    try {
      setError('');
      const res = await fn();
      await refresh();
      if (successMsg) setNotice({ type: 'success', text: successMsg });
      return res;
    } catch (e) {
      // One persistent, dismissible notice, visible above dialogs as well as pages.
      setNotice({ type: 'error', text: e?.message || 'تعذّر إتمام العملية؛ تحقق من المدخلات والاتصال ثم حاول مجددًا' });
      // re-thrown so callers can keep their dialog open; marked as already shown to the user
      if (e && typeof e === 'object') e.aomsReported = true;
      throw e;
    }
  };

  // Click handlers `await runAction(...)` and then close their dialog; when the action fails the
  // re-thrown error has already been shown as a notice, so it must not surface as an
  // "Uncaught (in promise)" page error.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUnhandled = ev => {
      if (ev.reason && ev.reason.aomsReported) ev.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, []);

  const value = {
    repo,
    service,
    session,
    profile,
    data,
    loading: loading || (!!session && !dataReady),
    dataReady,
    error,
    setError,
    notice,
    setNotice,
    online,
    refresh,
    runAction,
    signIn: (email, password) => repo.signIn(email, password),
    resetPassword: email => repo.resetPassword(email),
    signOut: () => repo.signOut(),
  };

  return <C.Provider value={value}>{children}</C.Provider>;
}
