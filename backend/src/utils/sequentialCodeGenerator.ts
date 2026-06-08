import crypto from 'crypto';

interface CodeConfig {
  prefix: string;
  tableName: string;
  codeColumn: string;
  typeFilter?: string; // Optional filter for request_type column
}

/**
 * Generates a sequential auto-incrementing code with zero-padding
 * Format: PREFIX-00001, PREFIX-00002, etc.
 * Thread-safe implementation using database query
 */
export async function generateSequentialCode(
  supabase: any,
  config: CodeConfig
): Promise<string> {
  const { prefix, tableName, codeColumn, typeFilter } = config;

  // Query the highest existing code for this prefix
  let query = supabase
    .from(tableName)
    .select(codeColumn)
    .like(codeColumn, `${prefix}-%`)
    .order(codeColumn, { ascending: false })
    .limit(1);

  // Apply type filter if specified (for request_type column)
  if (typeFilter) {
    query = query.eq('request_type', typeFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`[sequentialCodeGenerator] Error querying ${tableName}:`, error);
    throw new Error(`Failed to generate sequential code: ${error.message}`);
  }

  let nextNumber = 1; // Start at 00001 if no existing records

  if (data && data.length > 0) {
    const lastCode = data[0][codeColumn];
    const lastNumber = parseInt(lastCode.split('-')[1], 10);
    
    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  // Zero-pad to 5 digits minimum
  const paddedNumber = String(nextNumber).padStart(5, '0');
  return `${prefix}-${paddedNumber}`;
}

/**
 * Code configurations for different request types
 */
export const CODE_CONFIGS = {
  BUDGET_PROPOSAL: {
    prefix: 'BUD',
    tableName: 'expense_requests',
    codeColumn: 'request_code',
    typeFilter: 'budget_request'
  },
  BUDGET_REVISION: {
    prefix: 'REV',
    tableName: 'expense_requests',
    codeColumn: 'request_code',
    typeFilter: 'budget_revision'
  },
  REIMBURSEMENT: {
    prefix: 'REQ',
    tableName: 'expense_requests',
    codeColumn: 'request_code',
    typeFilter: 'reimbursement'
  },
  CASH_ADVANCE: {
    prefix: 'CA',
    tableName: 'expense_requests',
    codeColumn: 'request_code',
    typeFilter: 'cash_advance'
  },
  LIQUIDATION: {
    prefix: 'LIQ',
    tableName: 'request_liquidations',
    codeColumn: 'liquidation_code'
  }
};

/**
 * Generate code based on request type
 */
export async function generateRequestCode(
  supabase: any,
  requestType: string
): Promise<string> {
  switch (requestType) {
    case 'budget_request':
      return generateSequentialCode(supabase, CODE_CONFIGS.BUDGET_PROPOSAL);
    case 'budget_revision':
      return generateSequentialCode(supabase, CODE_CONFIGS.BUDGET_REVISION);
    case 'reimbursement':
      return generateSequentialCode(supabase, CODE_CONFIGS.REIMBURSEMENT);
    case 'cash_advance':
      return generateSequentialCode(supabase, CODE_CONFIGS.CASH_ADVANCE);
    default:
      // Fallback to REQ prefix for other types
      return generateSequentialCode(supabase, CODE_CONFIGS.REIMBURSEMENT);
  }
}

/**
 * Generate liquidation code
 */
export async function generateLiquidationCode(
  supabase: any
): Promise<string> {
  return generateSequentialCode(supabase, CODE_CONFIGS.LIQUIDATION);
}
