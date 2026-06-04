/** President approval required for amounts strictly above this value (in request currency). */
export const PRESIDENT_THRESHOLD = 500000; // $500K threshold for expense tickets

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
