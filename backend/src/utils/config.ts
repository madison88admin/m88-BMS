export type CashAdvanceAgingConfig = {
  bucket_1_days: number;
  bucket_2_days: number;
  bucket_3_days: number;
  overdue_notification_days: number;
};

const DEFAULT_CASH_ADVANCE_AGING_CONFIG: CashAdvanceAgingConfig = {
  bucket_1_days: 7,
  bucket_2_days: 14,
  bucket_3_days: 30,
  overdue_notification_days: 1
};

let activeCashAdvanceAgingConfig: CashAdvanceAgingConfig = {
  bucket_1_days: Number(process.env.CASH_ADVANCE_AGING_BUCKET_1_DAYS) || DEFAULT_CASH_ADVANCE_AGING_CONFIG.bucket_1_days,
  bucket_2_days: Number(process.env.CASH_ADVANCE_AGING_BUCKET_2_DAYS) || DEFAULT_CASH_ADVANCE_AGING_CONFIG.bucket_2_days,
  bucket_3_days: Number(process.env.CASH_ADVANCE_AGING_BUCKET_3_DAYS) || DEFAULT_CASH_ADVANCE_AGING_CONFIG.bucket_3_days,
  overdue_notification_days: Number(process.env.CASH_ADVANCE_OVERDUE_NOTIFICATION_DAYS) || DEFAULT_CASH_ADVANCE_AGING_CONFIG.overdue_notification_days
};

export const getCashAdvanceAgingConfig = async (): Promise<CashAdvanceAgingConfig> => {
  return activeCashAdvanceAgingConfig;
};

export const updateCashAdvanceAgingConfig = async (payload: Partial<CashAdvanceAgingConfig>): Promise<CashAdvanceAgingConfig> => {
  activeCashAdvanceAgingConfig = {
    ...activeCashAdvanceAgingConfig,
    ...payload
  };
  return activeCashAdvanceAgingConfig;
};
