import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '../../constants/theme';
import { PRODUCT_CATEGORIES_LIST } from '../../constants/enums';
import { useProducts } from '../../hooks/useProducts';
import { Loading, ErrorView, EmptyView } from '../../components/ui/Loading';
import { Product } from '../../types';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - Spacing.xl * 2 - Spacing.md) / 2;

function ProductCard({ product }: { product: Product }) {
  const imageSource = product.imagesBase64?.[0]?.base64
    ? { uri: `data:image/${product.imagesBase64[0].extension};base64,${product.imagesBase64[0].base64}` }
    : null;

  const discountedPrice = product.price.discountPercentage > 0
    ? product.price.pdtPrice * (1 - product.price.discountPercentage / 100)
    : product.price.pdtPrice;

  return (
    <TouchableOpacity
      style={styles.productCard}
      onPress={() => router.push(`/(user)/product-detail/${product._id}`)}
      activeOpacity={0.8}
    >
      <View style={styles.productImageContainer}>
        {imageSource ? (
          <Image source={imageSource} style={styles.productImage} resizeMode="cover" />
        ) : (
          <Ionicons name="image-outline" size={40} color={Colors.textMuted} />
        )}
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={2}>
          {product.productName}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.productPrice}>₹{discountedPrice.toFixed(0)}</Text>
          {product.price.discountPercentage > 0 && (
            <Text style={styles.originalPrice}>₹{product.price.pdtPrice}</Text>
          )}
        </View>
        {product.price.discountPercentage > 0 && (
          <Text style={styles.discountBadge}>
            {product.price.discountPercentage}% OFF
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ProductsScreen() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [page, setPage] = useState(1);
  const pincode = 110001; // Default pincode - should come from user data

  const { data: products, isLoading, error, refetch } = useProducts(
    pincode,
    selectedCategory,
    page
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Products</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Category Filter */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={PRODUCT_CATEGORIES_LIST}
        keyExtractor={(item) => item.value}
        contentContainerStyle={styles.categoryList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === item.value && styles.categoryChipActive,
            ]}
            onPress={() => {
              setSelectedCategory(item.value);
              setPage(1);
            }}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === item.value && styles.categoryChipTextActive,
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Products Grid */}
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorView message={error.message} onRetry={refetch} />
      ) : !products || products.length === 0 ? (
        <EmptyView
          icon="cube-outline"
          title="No products found"
          message="Try a different category"
        />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item._id}
          numColumns={2}
          contentContainerStyle={styles.productsGrid}
          columnWrapperStyle={styles.productsRow}
          renderItem={({ item }) => <ProductCard product={item} />}
          onEndReached={() => setPage((p) => p + 1)}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            products.length >= 10 ? (
              <View style={{ padding: Spacing.xl, alignItems: 'center' }}>
                <Text style={{ color: Colors.textMuted }}>Loading more...</Text>
              </View>
            ) : null
          }
        />
      )}
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
  categoryList: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
  },
  categoryChipActive: {
    backgroundColor: Colors.accent,
  },
  categoryChipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  categoryChipTextActive: {
    color: Colors.white,
    fontWeight: '600',
  },
  productsGrid: {
    padding: Spacing.lg,
  },
  productsRow: {
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  productCard: {
    width: CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  productImageContainer: {
    height: CARD_WIDTH,
    backgroundColor: Colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productInfo: {
    padding: Spacing.md,
  },
  productName: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: '500',
    marginBottom: Spacing.xs,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  productPrice: {
    fontSize: FontSize.md,
    fontWeight: 'bold',
    color: Colors.accent,
  },
  originalPrice: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textDecorationLine: 'line-through',
  },
  discountBadge: {
    fontSize: FontSize.xs,
    color: Colors.success,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
});
