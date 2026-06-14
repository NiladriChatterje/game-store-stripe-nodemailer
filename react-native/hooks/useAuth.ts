import { useCallback, useEffect } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useAuthStore } from '../store/authStore';
import { useUserStore } from '../store/userStore';
import { useAdminStore } from '../store/adminStore';
import { useShipperStore } from '../store/shipperStore';
import { setGetTokenFn } from '../services/api';

/**
 * Hook that syncs Clerk auth state with local stores and sets up
 * the API token fetcher for all service calls.
 */
export function useAuthSetup() {
  const { isSignedIn, user } = useUser();
  const { getToken, signOut } = useAuth();
  const { loginType, setLoginType, hydrate } = useAuthStore();
  const { clearUser } = useUserStore();
  const { clearAdmin } = useAdminStore();
  const { clearShipper } = useShipperStore();

  // Hydrate stored login type on mount
  useEffect(() => {
    hydrate();
  }, []);

  // Set up getToken for API service layer
  useEffect(() => {
    if (getToken) {
      setGetTokenFn(() => getToken({ template: undefined }));
    }
  }, [getToken]);

  const switchRole = useCallback(
    async (role: string) => {
      await setLoginType(role);
    },
    [setLoginType]
  );

  const handleSignOut = useCallback(async () => {
    await signOut();
    await setLoginType('');
    clearUser();
    clearAdmin();
    clearShipper();
  }, [signOut, setLoginType, clearUser, clearAdmin, clearShipper]);

  const getUserToken = useCallback(async () => {
    try {
      return await getToken();
    } catch {
      return null;
    }
  }, [getToken]);

  return {
    isSignedIn: !!isSignedIn,
    user,
    loginType,
    switchRole,
    handleSignOut,
    getUserToken,
  };
}
