import { get } from './api';
import { API } from '../constants/config';

export const searchService = {
  /** Search products by text query (uses vector embeddings) */
  searchProducts: (query: string) =>
    get<any>(API.SEARCH, `/search?s=${encodeURIComponent(query)}`),
};
