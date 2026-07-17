/** VP approval required for amounts at or above this value (in request currency). */
export const VP_THRESHOLD = 30000; // ₱30,000 threshold for VP approval

export const getVpThreshold = (currency = 'PHP') => {
  void currency;
  return VP_THRESHOLD;
};

/** President approval required for amounts strictly above this value (in request currency). */
export const PRESIDENT_THRESHOLD = 500000; // ₱500K threshold for President approval

export const getPresidentThreshold = (currency = 'PHP') => {
  void currency;
  return PRESIDENT_THRESHOLD;
};

/** Budget proposals at this amount or above require President final approval. */
export const BUDGET_PRESIDENT_THRESHOLD = 500; // $500 threshold for budget proposals

export const getBudgetPresidentThreshold = (currency = 'PHP') => {
  void currency;
  return BUDGET_PRESIDENT_THRESHOLD;
};
