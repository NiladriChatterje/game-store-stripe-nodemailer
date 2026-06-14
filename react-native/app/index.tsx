import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../store/authStore';
import { Colors, FontSize, Spacing } from '../constants/theme';

export default function IndexScreen() {
  const { isSignedIn, isLoaded } = useAuth();
  const { loginType, isHydrated } = useAuthStore();

  // Show loading while state is being restored
  if (!isLoaded || !isHydrated) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>XV Store</Text>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  // If not signed in, redirect to user section (public)
  if (!isSignedIn) {
    return <Redirect href="/(user)" />;
  }

  // Route based on stored login type
  if (loginType === 'admin') {
    return <Redirect href="/(admin)" />;
  }

  if (loginType === 'shipper') {
    return <Redirect href="/(shipper)" />;
  }

  // Default to user
  return <Redirect href="/(user)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: Spacing.xl,
  },
  title: {
    fontSize: FontSize.hero,
    fontWeight: 'bold',
    color: Colors.text,
    letterSpacing: 4,
  },
});
