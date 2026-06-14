import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '../../constants/theme';
import { Button } from '../../components/ui/Button';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';

const { width } = Dimensions.get('window');

const FEATURES = [
  {
    icon: 'cube-outline' as const,
    title: 'Wide Selection',
    desc: 'Thousands of products across multiple categories',
  },
  {
    icon: 'car-outline' as const,
    title: 'Fast Shipping',
    desc: 'Quick delivery within 3-5 business days',
  },
  {
    icon: 'swap-horizontal-outline' as const,
    title: 'Easy Returns',
    desc: '30-day return policy with hassle-free refunds',
  },
  {
    icon: 'headset-outline' as const,
    title: '24/7 Support',
    desc: 'Dedicated team ready to help anytime',
  },
];

const CATEGORIES = [
  { label: 'Electronics', icon: 'laptop-outline' as const },
  { label: 'Gaming', icon: 'game-controller-outline' as const },
  { label: 'Home & Garden', icon: 'home-outline' as const },
  { label: 'Fashion', icon: 'shirt-outline' as const },
  { label: 'Sports', icon: 'basketball-outline' as const },
  { label: 'Books', icon: 'book-outline' as const },
];

export default function HomeScreen() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { loginType, setLoginType } = useAuthStore();
  const { getItemCount } = useCartStore();
  const [showLoginOptions, setShowLoginOptions] = useState(false);

  const cartCount = getItemCount();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brand}>
          <Text style={styles.brandXv}>XV</Text>
          <Text style={styles.brandShop}>Shop</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.cartButton}
            onPress={() => router.push('/(user)/cart')}
          >
            <Ionicons name="bag-outline" size={24} color={Colors.text} />
            {cartCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{cartCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Welcome to Your Marketplace</Text>
          <Text style={styles.heroSubtitle}>
            Discover premium products across all categories
          </Text>
          <Button
            title="Browse Products"
            onPress={() => router.push('/(user)/products')}
            size="lg"
            style={styles.heroButton}
          />
        </View>

        {/* Features */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Why Choose Us</Text>
          <View style={styles.featuresGrid}>
            {FEATURES.map((f, i) => (
              <View key={i} style={styles.featureCard}>
                <Ionicons name={f.icon} size={28} color={Colors.accent} />
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Categories */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Shop by Category</Text>
          <View style={styles.categoriesGrid}>
            {CATEGORIES.map((c, i) => (
              <TouchableOpacity
                key={i}
                style={styles.categoryCard}
                onPress={() => router.push('/(user)/products')}
              >
                <Ionicons name={c.icon} size={32} color={Colors.accent} />
                <Text style={styles.categoryLabel}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Auth section for non-signed-in users */}
        {!isSignedIn && (
          <View style={styles.authSection}>
            <Text style={styles.authTitle}>Sign in for the full experience</Text>
            <Text style={styles.authDesc}>
              Track orders, manage your cart, and more
            </Text>

            <TouchableOpacity
              style={styles.loginButton}
              onPress={() => setShowLoginOptions(!showLoginOptions)}
            >
              <Text style={styles.loginButtonText}>Sign In</Text>
            </TouchableOpacity>

            {showLoginOptions && (
              <View style={styles.loginOptions}>
                {(['user', 'admin', 'shipper'] as const).map((role) => (
                  <TouchableOpacity
                    key={role}
                    style={styles.roleButton}
                    onPress={() => {
                      setLoginType(role);
                      setShowLoginOptions(false);
                    }}
                  >
                    <Text style={styles.roleButtonText}>
                      {role === 'admin' ? 'Seller' : role === 'user' ? 'User' : 'Shipper'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  brandXv: {
    fontSize: FontSize.xxl,
    fontWeight: 'bold',
    color: Colors.accent,
    letterSpacing: 2,
  },
  brandShop: {
    fontSize: FontSize.xxl,
    fontWeight: '300',
    color: Colors.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  cartButton: {
    position: 'relative',
    padding: Spacing.sm,
  },
  cartBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.full,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartBadgeText: {
    color: Colors.white,
    fontSize: FontSize.xs,
    fontWeight: 'bold',
  },
  hero: {
    padding: Spacing.xxl,
    alignItems: 'center',
    paddingTop: Spacing.xxxl * 1.5,
  },
  heroTitle: {
    fontSize: FontSize.title,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  heroSubtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
    lineHeight: 22,
  },
  heroButton: {
    minWidth: 200,
  },
  section: {
    padding: Spacing.xl,
  },
  sectionTitle: {
    fontSize: FontSize.xl,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  featureCard: {
    width: (width - Spacing.xl * 2 - Spacing.md) / 2,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  featureTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  featureDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  categoryCard: {
    width: (width - Spacing.xl * 2 - Spacing.md) / 3 - Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    ...Shadow.sm,
  },
  categoryLabel: {
    fontSize: FontSize.xs,
    color: Colors.text,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  authSection: {
    padding: Spacing.xl,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.xl,
    borderRadius: BorderRadius.xl,
    marginTop: Spacing.md,
  },
  authTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
  },
  authDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
  },
  loginButtonText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  loginOptions: {
    width: '100%',
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  roleButton: {
    backgroundColor: Colors.surfaceLight,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  roleButtonText: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
});
