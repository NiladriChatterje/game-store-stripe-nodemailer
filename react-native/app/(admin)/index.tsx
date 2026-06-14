import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useAdminStore } from '../../store/adminStore';
import { useAdminData } from '../../hooks/useAdmin';
import { Colors, FontSize, Spacing } from '../../constants/theme';

export default function AdminEntryScreen() {
  const { isSignedIn, user } = useUser();
  const { loginType } = useAuthStore();
  const { isPlanActive, setAdmin, setIsPlanActive } = useAdminStore();
  const adminId = user?.id ? `seller-${user.id}` : undefined;

  const { data: adminData, isLoading, error } = useAdminData(adminId);

  useEffect(() => {
    if (adminData) {
      setAdmin(adminData);
      setIsPlanActive(!!adminData.isPlanActive);
    }
  }, [adminData]);

  // Not signed in or wrong role - redirect to user
  if (!isSignedIn || loginType !== 'admin') {
    return <Redirect href="/(user)" />;
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Loading admin panel...</Text>
      </View>
    );
  }

  if (error || !adminData) {
    return <Redirect href="/(user)" />;
  }

  // Check subscription
  if (!isPlanActive) {
    return <Redirect href="/(admin)/subscription-plan" />;
  }

  // Check profile completion
  const addr = adminData.address;
  const isProfileComplete = Boolean(
    addr?.pincode && addr?.county && addr?.state && addr?.country &&
    adminData.phone && adminData.gstin?.length >= 15
  );

  if (!isProfileComplete) {
    return <Redirect href="/(admin)/profile-setup" />;
  }

  // Check stores
  const allottedCount = adminData.subscriptionPlan?.reduce(
    (max: number, p: any) => Math.max(max, p.storeAllotment ?? 1), 0
  ) || 0;
  const storesConfigured = (adminData.stores?.length ?? 0) >= allottedCount;

  if (!storesConfigured) {
    return <Redirect href="/(admin)/store-setup" />;
  }

  // All checks passed - show dashboard
  return <Redirect href="/(admin)/dashboard" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: Spacing.md,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
});
