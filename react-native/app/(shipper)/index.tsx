import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useShipperStore } from '../../store/shipperStore';
import { Colors, FontSize, Spacing } from '../../constants/theme';
import { userService } from '../../services/userService';

export default function ShipperEntryScreen() {
  const { isSignedIn, user } = useUser();
  const { loginType } = useAuthStore();
  const { profileComplete, setProfileComplete, setShipperData } = useShipperStore();

  useEffect(() => {
    if (!isSignedIn || !user || loginType !== 'shipper') return;

    const checkProfile = async () => {
      try {
        const res = await userService.fetchShipperData(`shipper-${user.id}`);
        if (res.ok && res.data) {
          setShipperData(res.data as any);
          const data: any = res.data;
          const phoneOk = data.phone !== 0 && data.phone != null;
          const addr = data.address;
          const addressOk = addr?.pincode?.trim()?.length > 0 &&
            addr?.county?.trim()?.length > 0 &&
            addr?.country?.trim()?.length > 0 &&
            addr?.state?.trim()?.length > 0;
          setProfileComplete(phoneOk && addressOk);
        } else {
          // Shipper doesn't exist yet - create
          const shipperObj = {
            _id: `shipper-${user.id}`,
            username: user.firstName || '',
            email: user.emailAddresses?.[0]?.emailAddress || '',
          };
          await userService.createShipper(shipperObj);
          setProfileComplete(false);
        }
      } catch {
        setProfileComplete(false);
      }
    };

    checkProfile();
  }, [isSignedIn, user?.id]);

  if (!isSignedIn || loginType !== 'shipper') {
    return <Redirect href="/(user)" />;
  }

  if (profileComplete === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.text}>Checking profile...</Text>
      </View>
    );
  }

  if (!profileComplete) {
    return <Redirect href="/(shipper)/profile" />;
  }

  return <Redirect href="/(shipper)/dashboard" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: Spacing.md,
  },
  text: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
});
