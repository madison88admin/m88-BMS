export interface SubCategoryItem {
  name: string;
  code?: string;
}

export interface SubCategory {
  name: string;
  code?: string;
  items?: SubCategoryItem[];
}

export interface MainCategory {
  name: string;
  code?: string;
  subcategories: (string | SubCategory)[];
}

// NOTE: Categories are now database-driven via /api/budget/categories endpoint
// This file is kept for backward compatibility and helper functions only
// The actual category structure should be fetched from the database

// Get code for a category/item (helper function - should be used with database data)
export const getCategoryCode = (name: string, categories: any[] = []): string | undefined => {
  const category = categories.find((c: any) => c.category_name === name);
  return category?.category_code;
};

// Build searchable string with codes (helper function - should be used with database data)
export const buildCategorySearchString = (category: string, categories: any[] = []): string => {
  const parts = category.split(' > ');
  const codes: string[] = [];
  
  parts.forEach(part => {
    const code = getCategoryCode(part.trim(), categories);
    if (code) codes.push(code);
  });
  
  return `${category} ${codes.join(' ')}`;
};

// Legacy CATEGORY_STRUCTURE - kept for reference but should not be used
// Categories should be fetched from /api/budget/categories endpoint
export const CATEGORY_STRUCTURE: MainCategory[] = [];
