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
 * Uses a retry loop to survive race-condition duplicates.
 */
export async function generateSequentialCode(
  supabase: any,
  config: CodeConfig
): Promise<string> {
  const { prefix, tableName, codeColumn } = config;

  // Query the highest existing code for this prefix across ALL rows.
  // The prefix itself encodes the type (REQ, CA, BUD, etc.), so we must not
  // filter by request_type - legacy rows may have a different/null type.
  const { data, error } = await supabase
    .from(tableName)
    .select(codeColumn)
    .like(codeColumn, `${prefix}-%`)
    .order(codeColumn, { ascending: false })
    .limit(1);

  if (error) {
    console.error(`[sequentialCodeGenerator] Error querying ${tableName}:`, error);
    throw new Error(`Failed to generate sequential code: ${error.message}`);
  }

  let nextNumber = 1; // Start at 00001 if no existing records

  if (data && data.length > 0) {
    const lastCode = data[0][codeColumn];
    const match = String(lastCode).match(/-(\d+)$/);
    const lastNumber = match ? parseInt(match[1], 10) : NaN;

    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  // Retry loop in case another request grabbed the same number concurrently
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const paddedNumber = String(nextNumber + attempt).padStart(5, '0');
    const candidate = `${prefix}-${paddedNumber}`;

    // Fast existence check before returning the candidate
    const { data: existing, error: checkError } = await supabase
      .from(tableName)
      .select(codeColumn)
      .eq(codeColumn, candidate)
      .limit(1);

    if (checkError) {
      console.error(`[sequentialCodeGenerator] Error checking ${candidate}:`, checkError);
      throw new Error(`Failed to generate sequential code: ${checkError.message}`);
    }

    if (!existing || existing.length === 0) {
      return candidate;
    }
  }

  throw new Error(`Unable to generate unique sequential code for prefix ${prefix} after ${maxAttempts} attempts`);
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
  TRAVEL_BOOKING: {
    prefix: 'TRV',
    tableName: 'expense_requests',
    codeColumn: 'request_code',
    typeFilter: 'travel_booking'
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
    case 'travel_booking':
      return generateSequentialCode(supabase, CODE_CONFIGS.TRAVEL_BOOKING);
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
