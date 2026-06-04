/** Budget proposals at this amount or above require President final approval (expense/CA logic is separate). */
const PRESIDENT_THRESHOLD = 500000; // $500K threshold for expense tickets
const BUDGET_PRESIDENT_THRESHOLD = 500; // $500 threshold for budget proposals

const getPresidentThreshold = (currency = 'PHP') => {
  void currency;
  return PRESIDENT_THRESHOLD;
};

const getBudgetPresidentThreshold = (currency = 'PHP') => {
  void currency;
  return BUDGET_PRESIDENT_THRESHOLD;
};

module.exports = {
  PRESIDENT_THRESHOLD,
  BUDGET_PRESIDENT_THRESHOLD,
  getPresidentThreshold,
  getBudgetPresidentThreshold,
};
