import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useAdminStore } from '../../store/adminStore';
import { useAdminData, useDashboardMetrics } from '../../hooks/useAdmin';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '../../constants/theme';
import { Card } from '../../components/ui/Card';
import { Loading, ErrorView } from '../../components/ui/Loading';

const { width } = Dimensions.get('window');

const NAV_ITEMS = [
  { label: 'Orders', icon: 'receipt-outline' as const, route: 'orders' },
  { label: 'Add Product', icon: 'add-circle-outline' as const, route: 'add-product' },
  { label: 'Edit Product', icon: 'create-outline' as const, route: 'edit-product' },
  { label: 'Sales', icon: 'trending-up-outline' as const, route: 'sales' },
  { label: 'Stores', icon: 'storefront-outline' as const, route: 'stores' },
  { label: 'Subscription', icon: 'card-outline' as const, route: 'subscription' },
  { label: 'Payout', icon: 'cash-outline' as const, route: 'payout' },
  { label: 'Profile', icon: 'person-outline' as const, route: 'profile-setup' },
];

export default function AdminDashboardScreen() {
  const { user } = useUser();
  const { isPlanActive, admin, setAdmin } = useAdminStore();
  const adminId = user?.id ? `seller-${user.id}` : undefined;

  const { data: adminData, isLoading: adminLoading, refetch: refetchAdmin } =
    useAdminData(adminId);
  const {
    data: metrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useDashboardMetrics(adminId);

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (adminData) {
      setAdmin(adminData);
    }
  }, [adminData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchAdmin(), refetchMetrics()]);
    setRefreshing(false);
  };

  if (adminLoading) return <Loading message="Loading dashboard..." />;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh-outline" size={24} color={Colors.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
        }
      >
        {/* Welcome Banner */}
        <Card variant="outlined" style={styles.welcomeCard}>
          <Text style={styles.welcomeText}>Welcome, {user?.firstName || 'Seller'}!</Text>
          <Text style={styles.welcomeSubtext}>
            {isPlanActive ? 'Your subscription is active' : 'Please activate your subscription'}
          </Text>
        </Card>

        {/* Quick Stats */}
        {metrics && (
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{metrics.totalSales.value}</Text>
              <Text style={styles.statLabel}>Total Sales</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{metrics.ordersServed.value}</Text>
              <Text style={styles.statLabel}>Orders</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{metrics.activeCustomers.value}</Text>
              <Text style={styles.statLabel}>Customers</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{metrics.totalProductsInInventory.value}</Text>
              <Text style={styles.statLabel}>Products</Text>
            </View>
          </View>
        )}

        {/* More Metrics */}
        {metrics && (
          <View style={styles.metricsRow}>
            <Card style={styles.metricCard}>
              <Ionicons name="cash-outline" size={24} color={Colors.success} />
              <Text style={styles.metricValue}>{metrics.totalProfit.value}</Text>
              <Text style={styles.metricLabel}>Profit</Text>
              <Text style={styles.metricTrend}>{metrics.totalProfit.trend}</Text>
            </Card>
            <Card style={styles.metricCard}>
              <Ionicons name="cart-outline" size={24} color={Colors.info} />
              <Text style={styles.metricValue}>{metrics.productsSold.value}</Text>
              <Text style={styles.metricLabel}>Products Sold</Text>
              <Text style={styles.metricTrend}>{metrics.productsSold.trend}</Text>
            </Card>
          </View>
        )}

        {/* Navigation Grid */}
        <View style={styles.navSection}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.navGrid}>
            {NAV_ITEMS.map((item, i) => (
              <TouchableOpacity
                key={i}
                style={styles.navCard}
                onPress={() => router.push(`/(admin)/${item.route}`)}
              >
                <Ionicons name={item.icon} size={28} color={Colors.accent} />
                <Text style={styles.navLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Subscription Status */}
        <Card variant="outlined" style={styles.subscriptionCard}>
          <View style={styles.subscriptionRow}>
            <Ionicons
              name={isPlanActive ? 'checkmark-circle' : 'alert-circle'}
              size={24}
              color={isPlanActive ? Colors.success : Colors.warning}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.subscriptionTitle}>
                {isPlanActive ? 'Subscription Active' : 'No Active Subscription'}
              </Text>
              <Text style={styles.subscriptionDesc}>
                {isPlanActive
                  ? `Stores: ${admin?.stores?.length || 0} configured`
                  : 'Subscribe to start selling'}
              </Text>
            </View>
            {!isPlanActive && (
              <TouchableOpacity
                style={styles.subscribeButton}
                onPress={() => router.push('/(admin)/subscription-plan')}
              >
                <Text style={styles.subscribeButtonText}>Subscribe</Text>
              </TouchableOpacity>
            )}
          </View>
        </Card>

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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  headerTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },
  welcomeCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceLight,
  },
  welcomeText: {
    fontSize: FontSize.xl,
    fontWeight: 'bold',
    color: Colors.text,
  },
  welcomeSubtext: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  statCard: {
    width: (width - Spacing.lg * 2 - Spacing.sm) / 2,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  statValue: {
    fontSize: FontSize.xxl,
    fontWeight: 'bold',
    color: Colors.accent,
  },
  statLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  metricsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  metricCard: {
    flex: 1,
    padding: Spacing.lg,
  },
  metricValue: {
    fontSize: FontSize.lg,
    fontWeight: 'bold',
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  metricLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  metricTrend: {
    fontSize: FontSize.xs,
    color: Colors.success,
    marginTop: Spacing.xs,
  },
  navSection: {
    padding: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  navGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  navCard: {
    width: (width - Spacing.lg * 2 - Spacing.sm) / 4 - Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    ...Shadow.sm,
  },
  navLabel: {
    fontSize: FontSize.xs,
    color: Colors.text,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  subscriptionCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
  },
  subscriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  subscriptionTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  subscriptionDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  subscribeButton: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  subscribeButtonText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },
});
